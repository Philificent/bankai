/**
 * Gateway types: model aliasing, grouping, and budget tracking.
 *
 * The gateway sits between the agent loop and model APIs. It resolves
 * logical model names ("coding-primary") to concrete providers, handles
 * retries within a group, falls back across groups, and tracks spend.
 */

import type { ToolDef } from "@bankai/tools";
import type { ModelRequest, ModelResponse, ModelMessage, ProviderToolCall, ThinkingBlock, RedactedThinkingBlock } from "@bankai/core";

export type ProviderName = "anthropic" | "openai" | "openai-compatible";

export interface ModelAlias {
  /** Logical name used in AgentConfig.model, e.g. "coding-primary". */
  readonly name: string;
  /** Provider to route through. */
  readonly provider: ProviderName;
  /** Concrete model identifier, e.g. "claude-4-2-sonnet-20250514" or "gpt-4o". */
  readonly model: string;
  /** Cost info for budget tracking. */
  readonly costPer1MInputUSD: number;
  readonly costPer1MOutputUSD: number;
}

export interface ModelGroup {
  /** Group name for routing, e.g. "primary" or "cheap-fallback". */
  readonly name: string;
  /** Ordered list of provider/model pairs to try within this group. */
  readonly members: ReadonlyArray<{
    readonly provider: ProviderName;
    readonly model: string;
    readonly costPer1MInputUSD: number;
    readonly costPer1MOutputUSD: number;
  }>;
  /** Next group to fall back to on exhaustion. */
  readonly fallbackTo?: string;
}

export interface GatewayConfig {
  /** API keys per provider. */
  readonly apiKeys: Readonly<Record<ProviderName, string>>;
  /** Base URLs per provider (for openai-compatible). */
  readonly baseURLs: Readonly<Record<ProviderName, string>>;
  /** Model alias table: logical name → provider/model/cost. */
  readonly aliases: ReadonlyArray<ModelAlias>;
  /** Retry policy. */
  readonly retry: {
    readonly maxRetries: number;
    readonly baseBackoffMs: number;
  };
  /** Hard budget caps. */
  readonly budget: {
    readonly maxUSD: number;
    readonly maxTokens: number;
  };
}

/**
 * Capability adapter: projects the harness-native tool catalog and
 * conversation messages into a provider's wire format, and parses
 * provider responses back into harness-native types.
 */
export interface CapabilityAdapter {
  readonly provider: ProviderName;
  /** Convert the full request into provider wire format. */
  project(request: ModelRequest): Promise<ProjectedRequest>;
  /** Parse a raw provider response into harness-native ModelResponse. */
  parseResponse(raw: unknown): Promise<ModelResponse>;
}

export interface ProjectedRequest {
  readonly system: string;
  readonly messages: unknown[];
  readonly tools: unknown;
}

/**
 * Budget tracker interface. In-memory implementation fails open;
 * Postgres-backed implementation comes in Phase 3.
 */
export interface BudgetTracker {
  charge(tokens: { inputTokens: number; outputTokens: number }, costUSD: number): void;
  check(): { exceeded: boolean; reason?: "max_tokens" | "max_budget" };
  readonly spentUSD: number;
  readonly spentTokens: number;
}

/**
 * Async budget tracker for Postgres-backed persistence.
 * The report notes: "Budgets require Postgres; without a DB, max_budget
 * fails open." This interface persists charges across sessions.
 */
export interface AsyncBudgetTracker {
  charge(tokens: { inputTokens: number; outputTokens: number }, costUSD: number): Promise<void>;
  check(): Promise<{ exceeded: boolean; reason?: "max_tokens" | "max_budget" }>;
  readonly spentUSD: number;
  readonly spentTokens: number;
  /** Release any resources (e.g., DB connection pool). */
  close?(): Promise<void>;
}
