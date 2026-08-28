#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AgentSession, type AgentConfig, type AgentResult } from "@bankai/core";
import { DefaultCatalog } from "@bankai/tools";
import { OpenAIProvider } from "./provider.js";

interface CliOptions {
  readonly task: string;
  readonly model: string;
  readonly workingDir: string;
  readonly apiKey: string;
  readonly apiUrl: string;
  readonly maxIterations: number;
  readonly maxTokens: number;
  readonly maxBudgetUSD: number;
  readonly idleTimeoutMs: number;
  readonly verbose: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const env = process.env;
  const flags: Record<string, string> = {};
  const positionals: string[] = [];

  const booleanFlags = new Set(["verbose", "v", "help", "h"]);

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    if (booleanFlags.has(key)) {
      flags[key] = "true";
      continue;
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
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
    model: flags.model ?? env.BANKAI_MODEL ?? "gpt-4o",
    workingDir: flags["working-dir"] ?? env.BANKAI_WORKING_DIR ?? process.cwd(),
    apiKey: flags["api-key"] ?? env.BANKAI_API_KEY ?? "",
    apiUrl: flags["api-url"] ?? env.BANKAI_API_URL ?? "https://api.openai.com/v1",
    maxIterations: Number(flags["max-iterations"] ?? env.BANKAI_MAX_ITERATIONS ?? 50),
    maxTokens: Number(flags["max-tokens"] ?? env.BANKAI_MAX_TOKENS ?? 100000),
    maxBudgetUSD: Number(flags["max-budget"] ?? env.BANKAI_MAX_BUDGET_USD ?? 10),
    idleTimeoutMs: Number(flags["idle-timeout"] ?? env.BANKAI_IDLE_TIMEOUT_MS ?? 300000),
    verbose: flags.verbose !== undefined || flags.v !== undefined,
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

export async function main(argv: readonly string[]): Promise<AgentResult> {
  const options = parseArgs(argv);
  const workingDir = resolve(options.workingDir);

  telemetry("info", "bankai.start", {
    model: options.model,
    workingDir,
    maxIterations: options.maxIterations,
    maxTokens: options.maxTokens,
    maxBudgetUSD: options.maxBudgetUSD,
  });

  const provider = new OpenAIProvider({
    apiKey: options.apiKey,
    baseURL: options.apiUrl,
    model: options.model,
  });

  const config: AgentConfig = {
    model: options.model,
    workingDir,
    maxIterations: options.maxIterations,
    maxTokens: options.maxTokens,
    maxBudgetUSD: options.maxBudgetUSD,
    idleTimeoutMs: options.idleTimeoutMs,
    tools: new DefaultCatalog(),
    provider,
  };

  const session = new AgentSession(config);

  if (options.verbose) {
    // Write AGENTS.md if it doesn't exist, so the constitution loads
    const agentsPath = resolve(workingDir, "AGENTS.md");
    try {
      await readFile(agentsPath, "utf8");
    } catch {
      await mkdir(workingDir, { recursive: true });
      await writeFile(
        agentsPath,
        "# Bankai — Project Constitution\n\nAdd project-specific conventions here.\n",
        "utf8"
      );
    }
  }

  const result = await session.run(options.task);

  // Emit trace as JSONL to stderr
  for (const entry of result.trace) {
    telemetry(
      entry.type === "assistant" ? "debug" : "debug",
      `trace.${entry.type}`,
      entry.data
    );
  }

  telemetry("info", "bankai.finish", {
    stopReason: result.stopReason,
    iterations: result.iterations,
    usage: result.usage,
  });

  // JSON result to stdout
  process.stdout.write(
    JSON.stringify(
      {
        stopReason: result.stopReason,
        output: result.output,
        usage: result.usage,
        iterations: result.iterations,
      },
      null,
      2
    ) + "\n"
  );

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
