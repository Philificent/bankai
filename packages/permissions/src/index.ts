/**
 * Permission stack: deterministic deny/ask/allow rule evaluation.
 *
 * From the report: "Agent SDK evaluation order: hooks, then deny rules,
 * then ask rules / permission mode, then allow rules, then canUseTool."
 * "MCP annotations are hints, not contracts. Untrusted servers can lie."
 * "OS sandbox cut prompts 84%."
 *
 * Deny-and-continue: a blocked tool returns as a tool_result error,
 * not a crash. Three consecutive denials or 20 total escalate.
 */

import type { ToolDef, ToolExecutionContext, ToolCall } from "@bankai/tools";

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionContext {
  readonly workingDir: string;
  readonly dontAsk: boolean; // headless mode
}

export interface PermissionRule {
  /** Rule name for tracing. */
  readonly name: string;
  /** Risk level this rule applies to. */
  readonly risk: string;
  /** Return true if this rule matches the tool call. */
  matches(toolName: string, params: Record<string, unknown>, tool: ToolDef): boolean;
  /** Decision this rule produces. */
  readonly decision: PermissionDecision;
}

export interface PermissionCheckResult {
  readonly decision: PermissionDecision;
  readonly reason: string;
  readonly rule: PermissionRule | null;
  readonly deniedCount: number;
  readonly totalCount: number;
}

export interface PermissionStackConfig {
  readonly deny: PermissionRule[];
  readonly ask: PermissionRule[];
  readonly allow: PermissionRule[];
  /** Escalate to deny after this many consecutive denials. */
  readonly maxConsecutiveDenials: number;
  /** Escalate to deny after this many total denials. */
  readonly maxTotalDenials: number;
}

export class PermissionStack {
  private readonly config: PermissionStackConfig;
  private consecutiveDenials = 0;
  private totalDenials = 0;

  constructor(config: PermissionStackConfig) {
    this.config = config;
  }

  get deniedCount(): number {
    return this.totalDenials;
  }

  check(
    toolCall: ToolCall,
    tool: ToolDef,
    context: PermissionContext
  ): PermissionCheckResult {
    // 1. Deny rules — always block, no questions asked
    for (const rule of this.config.deny) {
      if (rule.matches(toolCall.name, toolCall.arguments, tool)) {
        this.consecutiveDenials += 1;
        this.totalDenials += 1;
        return {
          decision: "deny",
          reason: `Denied by rule: ${rule.name}`,
          rule,
          deniedCount: this.totalDenials,
          totalCount: this.totalDenials + this.consecutiveDenials,
        };
      }
    }

    // 2. Ask rules — check if approval is needed
    for (const rule of this.config.ask) {
      if (rule.matches(toolCall.name, toolCall.arguments, tool)) {
        if (context.dontAsk) {
          // Headless mode: allow with logging (classifier would go here)
          return {
            decision: "allow",
            reason: `Auto-approved (dontAsk/headless) by rule: ${rule.name}`,
            rule,
            deniedCount: this.totalDenials,
            totalCount: this.totalDenials + this.consecutiveDenials,
          };
        }
        return {
          decision: "ask",
          reason: `Approval required by rule: ${rule.name}`,
          rule,
          deniedCount: this.totalDenials,
          totalCount: this.totalDenials + this.consecutiveDenials,
        };
      }
    }

    // 3. Allow rules — explicit allow
    for (const rule of this.config.allow) {
      if (rule.matches(toolCall.name, toolCall.arguments, tool)) {
        this.consecutiveDenials = 0; // reset on allow
        return {
          decision: "allow",
          reason: `Allowed by rule: ${rule.name}`,
          rule,
          deniedCount: this.totalDenials,
          totalCount: this.totalDenials + this.consecutiveDenials,
        };
      }
    }

    // 4. Default: deny (fail-closed for tools not in the allow list)
    // In dontAsk mode, we allow safe tools
    if (context.dontAsk && tool.risk !== "destructive") {
      this.consecutiveDenials = 0;
      return {
        decision: "allow",
        reason: "Auto-approved (dontAsk mode, safe tool)",
        rule: null,
        deniedCount: this.totalDenials,
        totalCount: this.totalDenials + this.consecutiveDenials,
      };
    }

    this.consecutiveDenials += 1;
    this.totalDenials += 1;
    return {
      decision: "deny",
      reason: "Default deny — tool not in allow list",
      rule: null,
      deniedCount: this.totalDenials,
      totalCount: this.totalDenials + this.consecutiveDenials,
    };
  }

  /** Check if the denial count has exceeded escalation thresholds. */
  shouldEscalate(): boolean {
    return (
      this.consecutiveDenials >= this.config.maxConsecutiveDenials ||
      this.totalDenials >= this.config.maxTotalDenials
    );
  }
}

export { defaultPermissionConfig } from "./rules.js";
