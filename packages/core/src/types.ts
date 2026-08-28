/**
 * Core types for the Bankai agent harness.
 *
 * "Own the loop." The model produces the next action; the harness
 * owns context assembly, tool execution, stop conditions, and budget.
 */

import type { ToolDef, ToolResult, ToolCatalog, ToolExecutionContext } from "@bankai/tools";

/** Re-export tool types so consumers of @bankai/core don't need to import @bankai/tools separately. */
export type {
  ToolDef,
  ToolResult,
  ToolCall,
  ToolRisk,
  ToolCatalog,
  ToolExecutionContext,
} from "@bankai/tools";

export type AgentStopReason =
  | "done"          // model returned a final response with no tool calls
  | "max_iterations" // hit the iteration cap
  | "max_budget"     // exceeded token/dollar budget
  | "idle_timeout"   // no progress for N ms
  | "error";         // unrecoverable error

export interface AgentUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly totalCostUSD: number;
}

export interface AgentConfig {
  /** Model alias resolved by the gateway (Phase 3+). For now, a provider-specific identifier. */
  readonly model: string;
  /** Working directory for tool execution. */
  readonly workingDir: string;
  /** Maximum tool-call iterations before the loop is forced to stop. */
  readonly maxIterations: number;
  /** Hard stop: total token budget for the session. */
  readonly maxTokens: number;
  /** Hard stop: total cost budget in USD for the session. */
  readonly maxBudgetUSD: number;
  /** Kill the loop if no tool call completes within this many ms. */
  readonly idleTimeoutMs: number;
  /** Tool catalog the agent can use. */
  readonly tools: ToolCatalog;
  /** Model provider to call for completions. */
  readonly provider: ModelProvider;
  /** Optional system prompt prefix. If omitted, AGENTS.md is loaded. */
  readonly systemPrompt?: string;
}

export interface AgentResult {
  readonly stopReason: AgentStopReason;
  readonly output: string;
  readonly usage: AgentUsage;
  readonly iterations: number;
  readonly trace: readonly AgentTraceEntry[];
}

export interface AgentTraceEntry {
  readonly type: "assistant" | "tool_result" | "observation";
  readonly at: string; // ISO timestamp
  readonly data: Record<string, unknown>;
}

/**
 * Model provider interface — the abstraction the gateway (Phase 3) implements.
 * The loop calls `complete()` with the harness-native tool catalog;
 * the provider projects tools into its wire format.
 */
export interface ModelProvider {
  complete(request: ModelRequest): Promise<ModelResponse>;
  /** Estimated cost in USD for the given usage. Used for budget tracking. */
  costFor(usage: { inputTokens: number; outputTokens: number }): number;
}

export interface ModelRequest {
  readonly messages: readonly ModelMessage[];
  /** Harness-native tool catalog. Provider projects into wire format. */
  readonly tools: readonly ToolDef[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface ModelResponse {
  readonly content: string;
  readonly toolCalls?: readonly ProviderToolCall[];
  readonly stopReason: "end_turn" | "max_tokens" | "tool_use" | "refusal";
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
}

export interface ProviderToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ModelMessage {
  readonly role: MessageRole;
  /** For system/user/assistant. */
  readonly content?: string;
  /** For assistant role — tool calls requested. */
  readonly toolCalls?: readonly ProviderToolCall[];
  /** For tool role — the ID of the tool call being resolved. */
  readonly toolCallId?: string;
}
