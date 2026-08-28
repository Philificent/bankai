import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ToolExecutionContext } from "@bankai/tools";
import type {
  AgentConfig,
  AgentResult,
  AgentStopReason,
  AgentTraceEntry,
  AgentUsage,
  ModelMessage,
  ModelResponse,
  ProviderToolCall,
} from "./types.ts";

const DEFAULT_SYSTEM_PROMPT = `You are Bankai, a coding agent harness. You own the loop — context assembly, tool execution, stop conditions, and budget. The model is a swappable engine.

You have a small set of canonical tools: bash, file_read, file_edit, code_exec. Use them to navigate the codebase, make changes, and verify your work. Never re-read your own diff to declare done — verification is external.

Think step by step. For each turn:
1. Analyze the task.
2. Use tools to investigate and act.
3. When you have completed the task, provide a summary.

Stop when you have no more tool calls to make.`;

export class AgentSession {
  readonly config: AgentConfig;
  private messages: ModelMessage[] = [];
  private totalUsage: AgentUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, totalCostUSD: 0 };
  private iterations = 0;
  private trace: AgentTraceEntry[] = [];
  private lastActivityAt: number = Date.now();

  constructor(config: AgentConfig) {
    this.config = config;
  }

  get currentIterations(): number {
    return this.iterations;
  }

  get currentUsage(): AgentUsage {
    return this.totalUsage;
  }

  /** Build the initial system message — load AGENTS.md if no systemPrompt provided. */
  private async buildSystemMessage(): Promise<ModelMessage> {
    let content = this.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    const agentsMdPath = resolve(this.config.workingDir, "AGENTS.md");
    try {
      const agentsMd = await readFile(agentsMdPath, "utf8");
      if (agentsMd.trim().length > 0) {
        content = `${content}\n\n## Project Conventions (AGENTS.md)\n${agentsMd}`;
      }
    } catch {
      // No AGENTS.md — skip
    }

    return { role: "system", content };
  }

  private appendTrace(entry: AgentTraceEntry): void {
    this.trace.push(entry);
  }

  private accumulateUsage(response: ModelResponse): void {
    this.totalUsage = {
      inputTokens: this.totalUsage.inputTokens + response.usage.inputTokens,
      outputTokens: this.totalUsage.outputTokens + response.usage.outputTokens,
      totalTokens: this.totalUsage.totalTokens + response.usage.totalTokens,
      totalCostUSD:
        this.totalUsage.totalCostUSD + this.config.provider.costFor(response.usage),
    };
  }

  private checkBudget(): AgentStopReason | null {
    if (this.totalUsage.totalTokens >= this.config.maxTokens) {
      return "max_budget";
    }
    if (this.totalUsage.totalCostUSD >= this.config.maxBudgetUSD) {
      return "max_budget";
    }
    return null;
  }

  private checkIdle(): AgentStopReason | null {
    const elapsed = Date.now() - this.lastActivityAt;
    if (elapsed >= this.config.idleTimeoutMs) {
      return "idle_timeout";
    }
    return null;
  }

  /** Cap tool output to avoid context bloat (Phase 10 progressive compaction). */
  private capToolOutput(content: string): string {
    const max = this.config.maxToolOutputTokens ?? 0;
    if (max > 0 && content.length > max) {
      return `${content.slice(0, max)}\n\n[truncated — output exceeded ${max} characters]`;
    }
    return content;
  }

  /**
   * Progressive compaction: summarize earlier conversation turns into a
   * compact summary, preserving the system message (AGENTS.md) and recent
   * turns for active context. Triggered when turn count exceeds
   * compactionThreshold (Phase 10).
   */
  private compactMessages(): void {
    const threshold = this.config.compactionThreshold ?? 0;
    if (threshold <= 0 || this.messages.length <= threshold) {
      return;
    }
    const preserve = this.config.compactionPreserveTurns ?? 10;

    // Always preserve system message + initial user task
    const system = this.messages[0];
    if (system === undefined || system.role !== "system") {
      return; // safety: no system message
    }

    const early = this.messages.slice(1, this.messages.length - preserve);
    const recent = this.messages.slice(this.messages.length - preserve);

    // Summarize earlier turns by concatenating and truncating
    let summary = "";
    for (const msg of early) {
      if (msg.role === "assistant") {
        summary += `Assistant: ${msg.content ?? ""}\n`;
      } else if (msg.role === "tool") {
        summary += `Tool: ${msg.content ?? ""}\n`;
      }
    }
    const maxSummaryLen = 2000;
    if (summary.length > maxSummaryLen) {
      summary = `${summary.slice(0, maxSummaryLen)}\n[...earlier context truncated in compaction]`;
    }

    this.messages = [
      system,
      { role: "user", content: `[Earlier context compacted: ${early.length} message(s) summarized. Recent conversation preserved.]\n\n${summary}` },
      ...recent,
    ];

    this.appendTrace({
      type: "observation",
      at: new Date().toISOString(),
      data: { event: "compaction", summaryLength: summary.length, preservedTurns: recent.length },
    });
  }

  /** Run the agent loop for a single task. */
  async run(task: string): Promise<AgentResult> {
    const systemMessage = await this.buildSystemMessage();
    this.messages = [systemMessage, { role: "user", content: task }];

    this.appendTrace({
      type: "observation",
      at: new Date().toISOString(),
      data: { event: "session_start", task, workingDir: this.config.workingDir },
    });

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Check hard caps before each model call
      const budgetStop = this.checkBudget();
      if (budgetStop) {
        return this.finish(budgetStop);
      }

      // Call the model
      const response = await this.config.provider.complete({
        messages: this.messages,
        tools: this.config.tools.list(),
        model: this.config.model,
      });

      this.accumulateUsage(response);
      this.lastActivityAt = Date.now();

      if (response.stopReason === "refusal") {
        return this.finish("error", response.content);
      }

      // Add assistant message
      const assistantMessage: ModelMessage = {
        role: "assistant",
        content: response.content,
        ...(response.toolCalls !== undefined ? { toolCalls: response.toolCalls } : {}),
        ...(response.thinking !== undefined ? { thinking: response.thinking } : {}),
        ...(response.redactedThinking !== undefined ? { redactedThinking: response.redactedThinking } : {}),
      };
      this.messages.push(assistantMessage);

      this.appendTrace({
        type: "assistant",
        at: new Date().toISOString(),
        data: {
          content: response.content,
          toolCallCount: response.toolCalls?.length ?? 0,
          usage: response.usage,
        },
      });

      const toolCalls = response.toolCalls;
      if (toolCalls === undefined || toolCalls.length === 0) {
        // No tool calls — model is done
        return this.finish("done", response.content);
      }

      // We have tool calls — increment iteration counter
      this.iterations += 1;

      if (this.iterations >= this.config.maxIterations) {
        // Execute remaining calls this round, then stop
        await this.executeToolCalls(toolCalls);
        return this.finish("max_iterations");
      }

      // Execute tool calls and append results
      await this.executeToolCalls(toolCalls);

      // Progressive compaction: compact if turn count exceeds threshold
      this.compactMessages();

      // Check idle timeout after tool execution
      const idleStop = this.checkIdle();
      if (idleStop) {
        return this.finish(idleStop);
      }
    }
  }

  private async executeToolCalls(calls: readonly ProviderToolCall[]): Promise<void> {
    const context: ToolExecutionContext = {
      workingDir: this.config.workingDir,
      logDir: resolve(this.config.workingDir, ".bankai", "logs"),
    };

    for (const call of calls) {
      const tool = this.config.tools.get(call.name);
      if (tool === undefined) {
        this.messages.push({
          role: "tool",
          toolCallId: call.id,
          content: `Tool "${call.name}" is not available in this catalog.`,
        });
        this.appendTrace({
          type: "tool_result",
          at: new Date().toISOString(),
          data: { toolCallId: call.id, toolName: call.name, error: "tool_not_found" },
        });
        continue;
      }

      // Check permissions before execution
      if (this.config.permissionChecker !== undefined) {
        const check = this.config.permissionChecker(call.name, call.arguments, {
          workingDir: context.workingDir,
        });
        const decision = typeof check === "string" ? check : check.decision;
        const reason = typeof check === "string" ? "" : check.reason;

        if (decision === "deny") {
          this.messages.push({
            role: "tool",
            toolCallId: call.id,
            content: `Tool "${call.name}" was denied by permission rules: ${reason}`,
          });
          this.appendTrace({
            type: "tool_result",
            at: new Date().toISOString(),
            data: { toolCallId: call.id, toolName: call.name, denied: true, reason },
          });
          continue;
        }

        if (decision === "ask") {
          // In headless mode, auto-approve (dontAsk equivalent)
          // In interactive mode, the caller would prompt the user here
          this.messages.push({
            role: "tool",
            toolCallId: call.id,
            content: `Tool "${call.name}" requires user approval (auto-denied in headless mode): ${reason}`,
          });
          this.appendTrace({
            type: "tool_result",
            at: new Date().toISOString(),
            data: { toolCallId: call.id, toolName: call.name, denied: true, reason, decision: "ask" },
          });
          continue;
        }
      }

      let result;
      try {
        result = await tool.executor(call.arguments, context);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result = {
          type: "error" as const,
          content: `Tool execution error: ${msg}`,
          trusted: true,
        };
      }

      const capped = this.capToolOutput(result.content);
      this.messages.push({
        role: "tool",
        toolCallId: call.id,
        content: capped,
      });

      this.appendTrace({
        type: "tool_result",
        at: new Date().toISOString(),
        data: {
          toolCallId: call.id,
          toolName: call.name,
          resultType: result.type,
          contentLength: capped.length,
          originalLength: result.content.length,
        },
      });

      this.lastActivityAt = Date.now();
    }
  }

  private finish(stopReason: AgentStopReason, output?: string): AgentResult {
    const lastAssistant = [...this.messages].reverse().find((m) => m.role === "assistant");
    const finalOutput = output ?? lastAssistant?.content ?? "";

    this.appendTrace({
      type: "observation",
      at: new Date().toISOString(),
      data: { event: "session_end", stopReason, iterations: this.iterations },
    });

    return {
      stopReason,
      output: finalOutput,
      usage: this.totalUsage,
      iterations: this.iterations,
      trace: this.trace,
    };
  }
}
