import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { StateGraph } from "./index.js";
import type { GraphNode } from "./index.js";

const makeNode = (name: string, nextNode: string | null, output?: string): GraphNode => ({
  name,
  handler: async (ctx: unknown) => {
    const context = ctx as Record<string, unknown>;
    const counter = (context.counter as number) ?? 0;
    if (counter >= 3) {
      return { nextNode: null, output: "done after 3 steps" };
    }
    return { nextNode, contextUpdate: { counter: counter + 1 } };
  },
});

describe("StateGraph", () => {
  it("runs nodes to completion", async () => {
    const graph = new StateGraph({
      name: "test-graph",
      startNode: "start",
      nodes: [makeNode("start", "middle"), makeNode("middle", "end"), makeNode("end", "end")],
    });

    const result = await graph.run();
    assert.equal((result.context.counter as number), 3);
    assert.equal(result.context._finalOutput, "done after 3 steps");
  });

  it("checkpoints and resumes", async () => {
    const graph = new StateGraph({
      name: "test-graph",
      startNode: "start",
      nodes: [makeNode("start", "middle"), makeNode("middle", "end"), makeNode("end", "end")],
    });

    // Step once
    await graph.step();
    assert.equal(graph.currentNodeName, "middle");

    // Checkpoint
    const cp = graph.checkpoint();
    assert.equal(cp.currentNode, "middle");
    assert.equal(cp.context.counter, 1);

    // New graph, resume from checkpoint
    const graph2 = new StateGraph({
      name: "test-graph",
      startNode: "start",
      nodes: [makeNode("start", "middle"), makeNode("middle", "end"), makeNode("end", "end")],
    });
    graph2.resumeFrom(cp);
    assert.equal(graph2.currentNodeName, "middle");

    await graph2.run();
    assert.equal((await graph2.run()).context.counter as number, 3);
  });

  it("respects max iterations", async () => {
    const graph = new StateGraph({
      name: "test-graph",
      startNode: "start",
      nodes: [makeNode("start", "start")],
      maxIterations: 5,
    });

    let count = 0;
    // Override the node handler to count infinite steps
    const infGraph = new StateGraph({
      name: "test-graph",
      startNode: "start",
      nodes: [{
        name: "start",
        handler: async () => { count++; return { nextNode: "start" }; },
      }],
      maxIterations: 5,
    });

    await infGraph.run();
    assert.equal(count, 5);
  });
});
