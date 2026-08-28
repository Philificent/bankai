/**
 * Eval harness for Bankai.
 *
 * Phase 7: "Evals are JSONL traces." Each eval run produces:
 * - A trace file (JSONL) with every step: observations, tool calls, results
 * - A scores file with per-task grades and aggregate metrics
 *
 * The harness runs tasks against a provided model endpoint and grades
 * the outcome against deterministic checks or LLM judges.
 */

import type { AgentResult } from "@bankai/core";

export type EvalOutcome = "pass" | "fail" | "partial";

export interface EvalCase {
  /** Unique identifier for this eval case. */
  readonly id: string;
  /** Short description of what's being tested. */
  readonly description: string;
  /** The task prompt to feed to the agent. */
  readonly task: string;
  /** Deterministic check: returns pass/fail with a reason. */
  grade: (result: AgentResult) => { passed: boolean; reason: string };
  /** Optional weight for aggregate scoring (default: 1). */
  readonly weight?: number;
  /** Expected stop reason for this task. */
  readonly expectStop?: string;
}

export interface EvalScore {
  readonly caseId: string;
  readonly description: string;
  readonly outcome: EvalOutcome;
  readonly reason: string;
  readonly iterations: number;
  readonly tokens: number;
  readonly costUSD: number;
  readonly durationMs: number;
}

export interface EvalReport {
  readonly allPassed: boolean;
  readonly passCount: number;
  readonly failCount: number;
  readonly totalCount: number;
  readonly passRate: number;
  readonly totalCostUSD: number;
  readonly totalTokens: number;
  readonly scores: readonly EvalScore[];
}

export class EvalRunner {
  private readonly cases: ReadonlyArray<EvalCase>;

  constructor(cases: ReadonlyArray<EvalCase>) {
    this.cases = cases;
  }

  /** Run all eval cases against the provided executor. */
  async runAll(executeTask: (task: string) => Promise<AgentResult>): Promise<EvalReport> {
    const scores: EvalScore[] = [];
    const start = Date.now();

    for (const c of this.cases) {
      const begin = Date.now();
      const result = await executeTask(c.task);
      const duration = Date.now() - begin;

      const grade = c.grade(result);
      const outcome: EvalOutcome = grade.passed ? "pass" : "fail";

      // Check expected stop reason if specified
      if (c.expectStop !== undefined && result.stopReason !== c.expectStop) {
        scores.push({
          caseId: c.id,
          description: c.description,
          outcome: "fail",
          reason: `Expected stopReason "${c.expectStop}" but got "${result.stopReason}"`,
          iterations: result.iterations,
          tokens: result.usage.totalTokens,
          costUSD: result.usage.totalCostUSD,
          durationMs: duration,
        });
        continue;
      }

      scores.push({
        caseId: c.id,
        description: c.description,
        outcome,
        reason: grade.reason,
        iterations: result.iterations,
        tokens: result.usage.totalTokens,
        costUSD: result.usage.totalCostUSD,
        durationMs: duration,
      });
    }

    const passCount = scores.filter((s) => s.outcome === "pass").length;
    const failCount = scores.length - passCount;
    const totalCostUSD = scores.reduce((sum, s) => sum + s.costUSD, 0);
    const totalTokens = scores.reduce((sum, s) => sum + s.tokens, 0);

    return {
      allPassed: failCount === 0,
      passCount,
      failCount,
      totalCount: scores.length,
      passRate: scores.length > 0 ? passCount / scores.length : 0,
      totalCostUSD,
      totalTokens,
      scores,
    };
  }

  /** Serialize results as JSONL for trace analysis. */
  toJSONL(report: EvalReport): string {
    const lines: string[] = [];
    for (const score of report.scores) {
      lines.push(JSON.stringify({
        type: "eval_score",
        ...score,
      }));
    }
    lines.push(JSON.stringify({
      type: "eval_summary",
      allPassed: report.allPassed,
      passCount: report.passCount,
      failCount: report.failCount,
      totalCount: report.totalCount,
      passRate: report.passRate,
      totalCostUSD: report.totalCostUSD,
      totalTokens: report.totalTokens,
    }));
    return lines.join("\n") + "\n";
  }
}

/**
 * Pre-defined eval cases for testing the agent.
 * Phase 7 target: 20-task suite covering core harness capabilities.
 */
export const defaultEvalCases: ReadonlyArray<EvalCase> = [
  {
    id: "bash_echo",
    description: "Agent can run bash echo and report the output",
    task: "Run 'echo hello_bankai' and tell me what it printed.",
    grade: (result) => {
      const passed = result.output.includes("hello_bankai");
      return { passed, reason: passed ? "Found 'hello_bankai' in output" : "Output did not contain expected string" };
    },
    expectStop: "done",
  },
  {
    id: "file_read",
    description: "Agent can read a file and report its contents",
    task: "Create a file called 'answer.txt' containing the word '42', then read it back.",
    grade: (result) => {
      const passed = result.output.toLowerCase().includes("42");
      return { passed, reason: passed ? "Found '42' in output" : "Output did not contain '42'" };
    },
  },
  {
    id: "max_iterations",
    description: "Agent stops at max_iterations cap",
    task: "Count to 1000.",
    grade: (result) => {
      const passed = result.stopReason === "max_iterations" || result.stopReason === "done";
      return { passed, reason: `stopReason was ${result.stopReason}` };
    },
  },
];
