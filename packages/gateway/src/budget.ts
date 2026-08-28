/**
 * In-memory budget tracker for Phase 2.
 *
 * The report notes: "Budgets require Postgres; without a DB, max_budget
 * fails open." This in-memory tracker covers a single session. The
 * Postgres-backed tracker (Phase 3) persists across sessions.
 */

import type { BudgetTracker } from "./types.js";

export interface InMemoryBudgetConfig {
  readonly maxUSD: number;
  readonly maxTokens: number;
}

export class InMemoryBudgetTracker implements BudgetTracker {
  private _spentUSD = 0;
  private _spentTokens = 0;
  private readonly maxUSD: number;
  private readonly maxTokens: number;

  constructor(config: InMemoryBudgetConfig) {
    this.maxUSD = config.maxUSD;
    this.maxTokens = config.maxTokens;
  }

  charge(tokens: { inputTokens: number; outputTokens: number }, costUSD: number): void {
    this._spentUSD += costUSD;
    const total = tokens.inputTokens + tokens.outputTokens;
    this._spentTokens += total;
  }

  check(): { exceeded: boolean; reason?: "max_tokens" | "max_budget" } {
    if (this._spentTokens >= this.maxTokens) {
      return { exceeded: true, reason: "max_tokens" };
    }
    if (this._spentUSD >= this.maxUSD) {
      return { exceeded: true, reason: "max_budget" };
    }
    return { exceeded: false };
  }

  get spentUSD(): number {
    return this._spentUSD;
  }

  get spentTokens(): number {
    return this._spentTokens;
  }
}
