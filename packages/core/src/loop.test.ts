import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { AgentSession } from "./loop.js";
import type { AgentConfig, ModelProvider, ModelRequest, ModelResponse } from "./types.js";
import { DefaultCatalog } from "@bankai/tools";

/**
 * Mock provider that simulates a model that calls bash once, then returns a final answer.
 */
class EchoMockProvider implements ModelProvider {
  private callCount = 0;
  costFor(_usage: { inputTokens: number; outputTokens: number }): number {
    return 0.001;
  }

  async complete(_request: ModelRequest): Promise<ModelResponse> {
    this.callCount += 1;

    if (this.callCount === 1) {
      return {
        content: "I'll check the workspace first.",
        toolCalls: [
          {
            id: "call_1",
            name: "bash",
            arguments: { command: "echo ready", cwd: undefined, timeout_ms: undefined },
          },
        ],
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      };
    }

    return {
      content: "Task complete. The workspace is ready.",
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    };
  }
}

async function makeConfig(overrides: Partial<AgentConfig> = {}): Promise<AgentConfig> {
  return {
    model: "test-model",
    workingDir: tmpdir(),
    maxIterations: overrides.maxIterations ?? 10,
    maxTokens: overrides.maxTokens ?? 100_000,
    maxBudgetUSD: overrides.maxBudgetUSD ?? 10,
    idleTimeoutMs: overrides.idleTimeoutMs ?? 300_000,
    tools: new DefaultCatalog(),
    provider: overrides.provider ?? new EchoMockProvider(),
    ...(overrides.systemPrompt !== undefined ? { systemPrompt: overrides.systemPrompt } : {}),
  };
}

describe("AgentSession", () => {
  it("runs a ReAct loop and stops with 'done'", async () => {
    const config = await makeConfig();
    const session = new AgentSession(config);
    const result = await session.run("Check the workspace");

    assert.equal(result.stopReason, "done");
    assert.equal(result.iterations, 1);
    assert.equal(result.output, "Task complete. The workspace is ready.");
    assert.ok(result.usage.totalTokens > 0);
    assert.ok(result.trace.length > 0);
  });

  it("respects max_iterations", async () => {
    // Provider that always asks for tool calls
    class InfiniteProvider implements ModelProvider {
      costFor(): number { return 0; }
      async complete(): Promise<ModelResponse> {
        return {
          content: "keep going",
          toolCalls: [
            { id: "loop", name: "bash", arguments: { command: "echo loop" } },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
    }

    const config = await makeConfig({ maxIterations: 3, provider: new InfiniteProvider() });
    const session = new AgentSession(config);
    const result = await session.run("Never stop");

    assert.equal(result.stopReason, "max_iterations");
    assert.equal(result.iterations, 3);
  });

  it("respects max_budget", async () => {
    let callCount = 0;
    class BudgetProvider implements ModelProvider {
      costFor(): number { return 5; }
      async complete(): Promise<ModelResponse> {
        callCount += 1;
        return {
          content: "working",
          toolCalls: [
            { id: `c${callCount}`, name: "bash", arguments: { command: "echo hi" } },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
        };
      }
    }

    const config = await makeConfig({ maxBudgetUSD: 10, maxIterations: 100, provider: new BudgetProvider() });
    const session = new AgentSession(config);
    const result = await session.run("Keep working");

    assert.equal(result.stopReason, "max_budget");
    assert.equal(result.iterations, 2);
  });

  it("handles unknown tool gracefully", async () => {
    let callCount = 0;
    class UnknownToolProvider implements ModelProvider {
      costFor(): number { return 0; }
      async complete(): Promise<ModelResponse> {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "Let me use a tool.",
            toolCalls: [
              { id: "u1", name: "nonexistent_tool", arguments: {} },
            ],
            stopReason: "tool_use",
            usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          };
        }
        return {
          content: "I see that tool isn't available. Stopping.",
          stopReason: "end_turn",
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        };
      }
    }

    const config = await makeConfig({ provider: new UnknownToolProvider() });
    const session = new AgentSession(config);
    const result = await session.run("Do something");

    // Unknown tool doesn't crash; model gets the error result and finishes
    assert.equal(result.stopReason, "done");
    assert.equal(result.iterations, 1);
  });
});
