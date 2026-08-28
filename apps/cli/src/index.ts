#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AgentSession, type AgentConfig, type AgentResult, SkillLoader } from "@bankai/core";
import { DefaultCatalog, createSandboxedCodeExecTool, defaultToolSet, type ToolCall } from "@bankai/tools";
import { GatewayRouter } from "@bankai/gateway";
import type { GatewayConfig, ModelAlias, AsyncBudgetTracker } from "@bankai/gateway";
import { PostgresBudgetTracker } from "@bankai/gateway";
import { PermissionStack, defaultPermissionConfig } from "@bankai/permissions";
import { EvalRunner, defaultEvalCases, type EvalReport } from "@bankai/evals";

interface CliOptions {
  readonly task: string;
  readonly model: string;
  readonly workingDir: string;
  readonly maxIterations: number;
  readonly maxTokens: number;
  readonly maxBudgetUSD: number;
  readonly idleTimeoutMs: number;
  readonly dontAsk: boolean;
  readonly verbose: boolean;
  readonly evalMode: boolean;
  readonly sandbox: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const env = process.env;
  const flags: Record<string, string> = {};
  const positionals: string[] = [];

  const booleanFlags = new Set(["verbose", "v", "help", "h", "dont-ask", "dontAsk", "eval", "e", "sandbox", "s"]);

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;

    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    // Strip leading dashes (--flag or -f)
    const key = token.startsWith("--") ? token.slice(2) : token.slice(1);
    if (booleanFlags.has(key)) {
      flags[key] = "true";
      continue;
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith("-")) {
      throw new Error(`Missing value for --${key}`);
    }
    flags[key] = value;
    i += 1;
  }

  const task = positionals.join(" ") || flags.task || "";
  if (!task) {
    throw new Error("No task provided. Usage: bankai \"<task description>\"");
  }

  return {
    task,
    model: flags.model ?? env.BANKAI_MODEL ?? "coding-primary",
    workingDir: flags["working-dir"] ?? env.BANKAI_WORKING_DIR ?? process.cwd(),
    maxIterations: Number(flags["max-iterations"] ?? env.BANKAI_MAX_ITERATIONS ?? 50),
    maxTokens: Number(flags["max-tokens"] ?? env.BANKAI_MAX_TOKENS ?? 100000),
    maxBudgetUSD: Number(flags["max-budget"] ?? env.BANKAI_MAX_BUDGET_USD ?? 10),
    idleTimeoutMs: Number(flags["idle-timeout"] ?? env.BANKAI_IDLE_TIMEOUT_MS ?? 300000),
    dontAsk: flags["dont-ask"] !== undefined || flags.dontAsk !== undefined,
    verbose: flags.verbose !== undefined || flags.v !== undefined,
    evalMode: flags.eval !== undefined || flags.e !== undefined,
    sandbox: flags.sandbox !== undefined || flags.s !== undefined,
  };
}

function telemetry(level: "info" | "debug" | "error", event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    event,
    level,
    at: new Date().toISOString(),
    ...data,
  });
  process.stderr.write(`${line}\n`);
}

function buildGatewayConfig(options: CliOptions): GatewayConfig {
  const env = process.env;

  const anthropicKey = env.BANKAI_ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY ?? "";
  const openaiKey = env.BANKAI_OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? env.BANKAI_API_KEY ?? "";

  const aliases: ModelAlias[] = [
    {
      name: "coding-primary",
      provider: "anthropic",
      model: env.BANKAI_CODING_MODEL ?? "claude-3-5-sonnet-20241022",
      costPer1MInputUSD: 15.0,
      costPer1MOutputUSD: 75.0,
    },
    {
      name: "cheap-compact",
      provider: "openai",
      model: env.BANKAI_COMPACT_MODEL ?? "gpt-4o-mini",
      costPer1MInputUSD: 3.0,
      costPer1MOutputUSD: 12.0,
    },
    {
      name: "gpt-4o",
      provider: "openai",
      model: "gpt-4o",
      costPer1MInputUSD: 3.0,
      costPer1MOutputUSD: 15.0,
    },
  ];

  return {
    apiKeys: {
      anthropic: anthropicKey,
      openai: openaiKey,
      "openai-compatible": openaiKey,
    },
    baseURLs: {
      anthropic: "https://api.anthropic.com",
      openai: "https://api.openai.com/v1",
      "openai-compatible": "https://api.openai.com/v1",
    },
    aliases,
    // Per-model tool profiles: cheap models get a reduced tool set
    toolProfiles: {
      "cheap-compact": ["bash", "file_read", "file_edit"],
    },
    // Per-model prompt profiles: cheaper model gets a shorter, critique-focused prompt
    promptProfiles: {
      "cheap-compact":
        "You are Bankai's critique agent. Review the code changes and the task spec. " +
        "Focus on correctness, edge cases, and security. Keep your review under 3 sentences.",
    },
    retry: {
      maxRetries: 3,
      baseBackoffMs: 1000,
    },
    budget: {
      maxUSD: options.maxBudgetUSD,
      maxTokens: options.maxTokens,
    },
  };
}

export async function main(argv: readonly string[]): Promise<AgentResult | EvalReport> {
  const options = parseArgs(argv);
  const workingDir = resolve(options.workingDir);

  telemetry("info", "bankai.start", {
    model: options.model,
    workingDir,
    maxIterations: options.maxIterations,
    maxTokens: options.maxTokens,
    maxBudgetUSD: options.maxBudgetUSD,
    dontAsk: options.dontAsk,
  });

  const gatewayConfig = buildGatewayConfig(options);

  // Use Postgres-backed budget tracker if BANKAI_DATABASE_URL is set
  const dbUrl = process.env.BANKAI_DATABASE_URL;
  const sessionId = process.env.BANKAI_SESSION_ID ?? `bankai_${Date.now()}`;
  let asyncBudget: AsyncBudgetTracker | undefined;
  if (dbUrl !== undefined && dbUrl.length > 0) {
    asyncBudget = new PostgresBudgetTracker({
      connectionString: dbUrl,
      maxUSD: options.maxBudgetUSD,
      maxTokens: options.maxTokens,
      sessionId,
    });
    telemetry("info", "bankai.budget_postgres", { connectionString: dbUrl });
  }

  const provider = new GatewayRouter(gatewayConfig, undefined, asyncBudget);

  // Use sandboxed code_exec when --sandbox is enabled
  const toolCatalog = options.sandbox
    ? new DefaultCatalog([
        ...defaultToolSet().filter((t) => t.name !== "code_exec"),
        createSandboxedCodeExecTool(workingDir),
      ])
    : new DefaultCatalog();

  // Load skills from the working directory's skills/ folder
  const skillsDir = resolve(workingDir, "skills");
  const skillLoader = new SkillLoader(skillsDir);
  const availableSkills = await skillLoader.list();

  telemetry("info", "bankai.skills", {
    available: availableSkills.map((s) => s.name),
  });

  // Create AGENTS.md if it doesn't exist so the constitution loads
  const agentsPath = resolve(workingDir, "AGENTS.md");
  try {
    await readFile(agentsPath, "utf8");
  } catch {
    const skillsSection = availableSkills.length > 0
      ? `\n\n## Available Skills\n${availableSkills.map((s) => `- **${s.name}**: ${s.description}`).join("\n")}\n`
      : "";
    await mkdir(workingDir, { recursive: true });
    await writeFile(
      agentsPath,
      `# Bankai — Project Constitution

## Model Aliases
- \`coding-primary\`: Claude 3.5 Sonnet (Anthropic) — use for coding tasks
- \`cheap-compact\`: GPT-4o-mini (OpenAI) — use for critique and compact tasks
- \`gpt-4o\`: GPT-4o (OpenAI) — direct OpenAI access

## Permission Stack
- Deny rules run as code before any tool executes (rm -rf, curl, chmod 777, etc.)
- Safe tools (ls, grep, file_read, code_exec) are auto-allowed in headless mode
- file_edit requires approval; use --dont-ask for headless operation

## Available Tools
- \`bash\`: Shell command execution
- \`file_read\`: Read files within the working directory
- \`file_edit\`: Create, replace, or delete files
- \`code_exec\`: Execute code in a sandboxed environment
${skillsSection}`,
      "utf8"
    );
  }

  // Permission stack — deny rules run as code before any tool executes
  const permissionStack = new PermissionStack(defaultPermissionConfig());

  const config: AgentConfig = {
    model: options.model,
    workingDir,
    maxIterations: options.maxIterations,
    maxTokens: options.maxTokens,
    maxBudgetUSD: options.maxBudgetUSD,
    idleTimeoutMs: options.idleTimeoutMs,
    tools: toolCatalog,
    provider,
    permissionChecker: (toolName: string, params: Record<string, unknown>) => {
      const tool = toolCatalog.get(toolName);
      if (tool === undefined) {
        return { decision: "deny" as const, reason: `Tool "${toolName}" not in catalog` };
      }
      const toolCall: ToolCall = {
        id: `perm_${Date.now()}`,
        name: toolName,
        arguments: params,
      };
      const result = permissionStack.check(toolCall, tool, { workingDir, dontAsk: options.dontAsk });
      const decision = result.decision;
      if (decision === "allow") {
        return "allow";
      }
      if (decision === "deny") {
        return { decision: "deny" as const, reason: result.reason };
      }
      // "ask" in headless mode → auto-approve (dontAsk equivalent)
      if (options.dontAsk) {
        return "allow";
      }
      return { decision: "ask" as const, reason: result.reason };
    },
    maxToolOutputTokens: 2000,
    compactionThreshold: options.maxIterations > 10 ? Math.max(10, Math.floor(options.maxIterations / 3)) : 0,
    compactionPreserveTurns: 10,
  };

  const session = new AgentSession(config);

  if (options.evalMode) {
    const runner = new EvalRunner(defaultEvalCases);
    const report = await runner.runAll(async (task: string) => {
      // Fresh session per eval case — no state leakage between cases
      const evalSession = new AgentSession(config);
      return await evalSession.run(task);
    });

    // Emit trace as JSONL to stdout
    process.stdout.write(runner.toJSONL(report));

    telemetry("info", "bankai.eval_finish", {
      passRate: report.passRate,
      passCount: report.passCount,
      failCount: report.failCount,
      totalCostUSD: report.totalCostUSD,
      totalTokens: report.totalTokens,
    });

    process.exitCode = report.allPassed ? 0 : 1;
    if (asyncBudget !== undefined && asyncBudget.close !== undefined) {
      await asyncBudget.close();
    }
    return report;
  }

  const result = await session.run(options.task);

  // Emit trace as JSONL to stderr
  for (const entry of result.trace) {
    telemetry("debug", `trace.${entry.type}`, entry.data);
  }

  telemetry("info", "bankai.finish", {
    stopReason: result.stopReason,
    iterations: result.iterations,
    usage: result.usage,
    spentUSD: provider.spentUSD,
    spentTokens: provider.spentTokens,
  });

  // JSON result to stdout
  process.stdout.write(
    JSON.stringify(
      {
        stopReason: result.stopReason,
        output: result.output,
        usage: result.usage,
        iterations: result.iterations,
        spentUSD: provider.spentUSD,
      },
      null,
      2
     ) + "\n"
   );

  if (asyncBudget !== undefined && asyncBudget.close !== undefined) {
    await asyncBudget.close();
  }

  return result;
}

const entrypoint = process.argv[1];
const isMain = entrypoint !== undefined && fileURLToPath(import.meta.url) === resolve(entrypoint);

if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    telemetry("error", "bankai.error", { error: message });
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  });
}

export { parseArgs };
