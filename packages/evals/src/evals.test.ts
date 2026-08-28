import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EvalRunner, defaultEvalCases } from "./index.js";
import type { AgentResult } from "@bankai/core";
import type { EvalReport } from "./index.js";

const mockResult = (output: string, overrides: Partial<AgentResult> = {}): AgentResult => ({
  stopReason: "done",
  output,
  usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, totalCostUSD: 0.001 },
  iterations: 1,
  trace: [],
  ...overrides,
});

describe("EvalRunner", () => {
  it("passes when output contains expected content", async () => {
    const runner = new EvalRunner([
      {
        id: "test-1",
        description: "simple test",
        task: "echo hello",
        grade: (result) => {
          const passed = result.output.includes("hello");
          return { passed, reason: passed ? "ok" : "fail" };
        },
      },
    ]);

    const report = await runner.runAll(async () => mockResult("hello world"));

    assert.equal(report.allPassed, true);
    assert.equal(report.passCount, 1);
    assert.equal(report.failCount, 0);
    assert.equal(report.totalCount, 1);
  });

  it("fails when output lacks expected content", async () => {
    const runner = new EvalRunner([
      {
        id: "test-2",
        description: "bad output test",
        task: "echo hello",
        grade: (result) => {
          const passed = result.output.includes("hello");
          return { passed, reason: passed ? "ok" : "fail" };
        },
      },
    ]);

    const report = await runner.runAll(async () => mockResult("goodbye world"));

    assert.equal(report.allPassed, false);
    assert.equal(report.failCount, 1);
  });

  it("checks expected stop reason", async () => {
    const runner = new EvalRunner([
      {
        id: "stop-test",
        description: "stop reason check",
        task: "test",
        grade: (result) => ({ passed: true, reason: "always pass" }),
        expectStop: "done",
      },
    ]);

    const report = await runner.runAll(async () =>
      mockResult("ok", { stopReason: "done" })
    );

    assert.equal(report.scores[0]!.outcome, "pass");

    const reportFail = await runner.runAll(async () =>
      mockResult("ok", { stopReason: "max_iterations" })
    );

    assert.equal(reportFail.scores[0]!.outcome, "fail");
    assert.match(reportFail.scores[0]!.reason, /Expected stopReason/);
  });

  it("serializes to JSONL with score and summary lines", () => {
    const runner = new EvalRunner([]);
    const report: EvalReport = {
      allPassed: true,
      passCount: 1,
      failCount: 0,
      totalCount: 1,
      passRate: 1.0,
      totalCostUSD: 0.001,
      totalTokens: 20,
      scores: [
        {
          caseId: "test",
          description: "test",
          outcome: "pass",
          reason: "ok",
          iterations: 1,
          tokens: 20,
          costUSD: 0.001,
          durationMs: 100,
        },
      ],
    };

    const jsonl = runner.toJSONL(report);
    const lines = jsonl.trim().split("\n");
    assert.equal(lines.length, 2);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.type, "eval_score");
    assert.equal(parsed.caseId, "test");
    const summary = JSON.parse(lines[1]!);
    assert.equal(summary.type, "eval_summary");
    assert.equal(summary.allPassed, true);
  });

  it("has default eval cases", () => {
    assert.ok(defaultEvalCases.length > 0);
    assert.equal(defaultEvalCases[0]!.id, "bash_echo");
  });
});
