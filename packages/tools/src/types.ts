/**
 * Harness-native tool catalog types.
 *
 * The model never sees these directly. The gateway adapter (Phase 3)
 * projects them into each provider's wire format. This is the portability layer.
 */

export type ToolRisk = "safe" | "requires_approval" | "destructive";

export interface ToolExecutionContext {
  /** The working directory for file/bash operations. */
  readonly workingDir: string;
  /** Directory for writing bulky tool output (so it doesn't bloat context). */
  readonly logDir?: string;
}

export interface ToolDef {
  /** Stable, snake_case identifier — must not change once in use. */
  readonly name: string;
  /** Human-readable description the model uses to decide whether to call this tool. */
  readonly description: string;
  /** JSON Schema (draft 2020-12) for the tool's parameters. */
  readonly parameters: ToolParameters;
  /** Risk classification drives the permission stack. */
  readonly risk: ToolRisk;
  /** Execute the tool with validated params. Called by the harness, not the model. */
  readonly executor: (params: unknown, context: ToolExecutionContext) => Promise<ToolResult>;
}

export interface ToolParameters {
  readonly type: "object";
  readonly properties: Record<string, JSONSchemaProperty>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface JSONSchemaProperty {
  readonly type: string;
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly items?: JSONSchemaProperty;
  readonly properties?: Record<string, JSONSchemaProperty>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** Parsed, validated arguments for the tool. */
  readonly arguments: Record<string, unknown>;
}

export interface ToolResult {
  /** "tool_result" — the harness turns this into a tool_result message. */
  readonly type: "result" | "error";
  /** Capped, small payload returned to the model context. */
  readonly content: string;
  /** If true, this result is safe to show to the model without further filtering. */
  readonly trusted: boolean;
  /** Optional structured data for harness-side consumption (not sent to the model). */
  readonly meta?: Record<string, unknown>;
}

export interface ToolCatalog {
  readonly tools: readonly ToolDef[];
  /** Look up a tool by name. Throws if not found. */
  get(name: string): ToolDef | undefined;
  /** Return the canonical tool list (already sorted by name). */
  list(): readonly ToolDef[];
}
