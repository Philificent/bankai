import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { AgentSession } from "./loop.js";
import type { AgentConfig, ModelProvider, ModelRequest, ModelResponse } from "./types.js";
import { DefaultCatalog, type ToolCatalog, type ToolDef, type ToolResult } from "@bankai/tools";

/** A tool catalog with a mock tool that can return a configurable result. */
class MockToolCatalog implements ToolCatalog {
  readonly tools: readonly ToolDef[] = [];
  private readonly tool: ToolDef;
  constructor(longResult = false) {
    this.tool = {
      name: "mock_tool",
      description: "For testing",
      risk: "safe" as const,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      executor: async (_args: unknown, _context: unknown): Promise<ToolResult> => ({
        type: "result" as const,
        content: longResult ? "X".repeat(5000) : "ok",
        trusted: true,
      }),
    };
    this.tools = [this.tool];
  }
  get(name: string): ToolDef | undefined {
    return name === this.tool.name ? this.tool : undefined;
  }
  list(): readonly ToolDef[] {
    return [this.tool];
  }
}

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
    tools: overrides.tools ?? new DefaultCatalog(),
    provider: overrides.provider ?? new EchoMockProvider(),
    ...(overrides.systemPrompt !== undefined ? { systemPrompt: overrides.systemPrompt } : {}),
    ...(overrides.maxToolOutputTokens !== undefined ? { maxToolOutputTokens: overrides.maxToolOutputTokens } : {}),
    ...(overrides.compactionThreshold !== undefined ? { compactionThreshold: overrides.compactionThreshold } : {}),
    ...(overrides.compactionPreserveTurns !== undefined ? { compactionPreserveTurns: overrides.compactionPreserveTurns } : {}),
  } as AgentConfig;
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

  it("caps tool output when maxToolOutputTokens is set", async () => {
    let callCount = 0;
    class LongToolProvider implements ModelProvider {
      costFor(): number { return 0; }
      async complete(): Promise<ModelResponse> {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: "Call the mock tool",
            toolCalls: [{ id: "lt1", name: "mock_tool", arguments: {} }],
            stopReason: "tool_use",
            usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          };
        }
        return {
          content: "Done.",
          stopReason: "end_turn",
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        };
      }
    }

    const config = await makeConfig({
      tools: new MockToolCatalog(true),
      provider: new LongToolProvider(),
      maxToolOutputTokens: 100,
    });
    const session = new AgentSession(config);
    const result = await session.run("Use the mock tool");

    // The tool_result trace entry should show capped content length
    const toolResultTrace = result.trace.find(
      (e) => e.type === "tool_result" && e.data.contentLength !== undefined
    );
    assert.ok(toolResultTrace);
    const cappedLength = toolResultTrace!.data.contentLength as number;
    assert.ok(cappedLength < 5000);
    assert.ok(cappedLength <= 100 + 100); // capped content + suffix overhead
  });

  it("compacts messages when turn count exceeds threshold", async () => {
    let callCount = 0;
    class LoopProvider implements ModelProvider {
      costFor(): number { return 0; }
      async complete(): Promise<ModelResponse> {
        callCount += 1;
        return {
          content: `Turn ${callCount}`,
          toolCalls: [{ id: `t${callCount}`, name: "mock_tool", arguments: {} }],
          stopReason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
    }

    const config = await makeConfig({
      tools: new MockToolCatalog(),
      provider: new LoopProvider(),
      maxIterations: 20,
      compactionThreshold: 5,
      compactionPreserveTurns: 4,
    });
    const session = new AgentSession(config);
    const result = await session.run("Loop until compacted");

    // Should hit max_iterations
    assert.equal(result.stopReason, "max_iterations");

    // Should have a compaction trace entry
    const compactionTrace = result.trace.find(
      (e) => e.type === "observation" && e.data.event === "compaction"
    );
    assert.ok(compactionTrace, "Expected a compaction trace entry");
    assert.ok(compactionTrace!.data.preservedTurns !== undefined);
  });
});
