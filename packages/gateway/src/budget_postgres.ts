/**
 * Postgres-backed budget tracker.
 *
 * Phase 10: persists spend across sessions and enforces hard caps.
 * Requires a Postgres database (BANKAI_DATABASE_URL or connection config).
 *
 * Schema:
 *   CREATE TABLE IF NOT EXISTS bankai_budget (
 *     session_id   TEXT PRIMARY KEY,
 *     spent_usd    NUMERIC(12,6) DEFAULT 0,
 *     spent_tokens BIGINT DEFAULT 0
 *   );
 */

import type { AsyncBudgetTracker } from "./types.js";

export interface PostgresBudgetConfig {
  readonly connectionString: string;
  readonly maxUSD: number;
  readonly maxTokens: number;
  readonly sessionId: string;
}

import { createRequire } from "node:module";

const createRequireFn = createRequire;
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
const require = createRequireFn(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pg: any = require("pg");

export class PostgresBudgetTracker implements AsyncBudgetTracker {
  private readonly config: PostgresBudgetConfig;
  private readonly pool: {
    query: (text: string, params: readonly unknown[]) => Promise<{ rows: readonly unknown[] }>;
    end: () => Promise<void>;
  };
  private _spentUSD = 0;
  private _spentTokens = 0;
  private initialized = false;

  constructor(config: PostgresBudgetConfig) {
    this.config = config;
    this.pool = new pg.Pool({ connectionString: config.connectionString });
  }

  private async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS bankai_budget (
        session_id   TEXT PRIMARY KEY,
        spent_usd    NUMERIC(12,6) DEFAULT 0,
        spent_tokens BIGINT DEFAULT 0
      )`,
      []
    );
    const result = await this.pool.query(
      "SELECT spent_usd, spent_tokens FROM bankai_budget WHERE session_id = $1",
      [this.config.sessionId]
    );
    if (result.rows.length > 0) {
      const row = result.rows[0] as { spent_usd: string | number; spent_tokens: number };
      this._spentUSD = Number(row.spent_usd);
      this._spentTokens = Number(row.spent_tokens);
    }
  }

  async charge(
    tokens: { inputTokens: number; outputTokens: number },
    costUSD: number
  ): Promise<void> {
    await this.init();
    this._spentUSD += costUSD;
    this._spentTokens += tokens.inputTokens + tokens.outputTokens;

    await this.pool.query(
      `INSERT INTO bankai_budget (session_id, spent_usd, spent_tokens)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO UPDATE
       SET spent_usd = EXCLUDED.spent_usd,
           spent_tokens = EXCLUDED.spent_tokens`,
      [
        this.config.sessionId,
        this._spentUSD.toFixed(6),
        this._spentTokens,
      ]
    );
  }

  async check(): Promise<{ exceeded: boolean; reason?: "max_tokens" | "max_budget" }> {
    if (this._spentTokens >= this.config.maxTokens) {
      return { exceeded: true, reason: "max_tokens" };
    }
    if (this._spentUSD >= this.config.maxUSD) {
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

  async close(): Promise<void> {
    await this.pool.end();
  }
}
