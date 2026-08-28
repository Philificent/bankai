/**
 * Typed state graph for Bankai subagents.
 *
 * Phase 9: "Typed state graph, subagents, hibernate/wake."
 * Each agent is a graph node. Subagents are spawned as separate graphs.
 * Checkpoints serialize state for hibernation/wake cycles.
 */

import type { AgentResult } from "@bankai/core";

export type NodeName = string & { readonly _brand: unique symbol };

export interface GraphNode<TContext = unknown> {
  readonly name: string;
  readonly handler: (context: TContext) => Promise<GraphNodeResult>;
}

export interface GraphNodeResult {
  readonly nextNode: string | null; // null = terminal
  readonly contextUpdate?: Record<string, unknown>;
  readonly output?: string;
  readonly spawnSubagent?: {
    readonly id: string;
    readonly prompt: string;
    readonly tools?: string[];
  };
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly condition?: (context: Record<string, unknown>) => boolean;
}

export interface Checkpoint {
  readonly id: string;
  readonly graphName: string;
  readonly currentNode: string;
  readonly context: Record<string, unknown>;
  readonly iteration: number;
  readonly createdAt: string;
  readonly agentState: AgentResult | null;
}

export interface GraphConfig {
  readonly name: string;
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges?: ReadonlyArray<GraphEdge>;
  readonly startNode: string;
  readonly maxIterations?: number;
  readonly maxBudgetUSD?: number;
  readonly maxTokens?: number;
  readonly idleTimeoutMs?: number;
}

export class StateGraph {
  private readonly config: GraphConfig;
  private context: Record<string, unknown> = {};
  private currentNode: string;
  private iteration = 0;

  constructor(config: GraphConfig, initialContext: Record<string, unknown> = {}) {
    this.config = config;
    this.currentNode = config.startNode;
    this.context = initialContext;
  }

  get currentNodeName(): string {
    return this.currentNode;
  }

  get contextState(): Record<string, unknown> {
    return this.context;
  }

  private getNode(name: string): GraphNode | undefined {
    return this.config.nodes.find((n) => n.name === name);
  }

  private getEdges(from: string): readonly GraphEdge[] {
    return this.config.edges?.filter((e) => e.from === from) ?? [];
  }

  /** Resume from a checkpoint. */
  resumeFrom(checkpoint: Checkpoint): void {
    if (checkpoint.graphName !== this.config.name) {
      throw new Error(`Checkpoint is for "${checkpoint.graphName}", not "${this.config.name}"`);
    }
    this.currentNode = checkpoint.currentNode;
    this.context = { ...checkpoint.context };
    this.iteration = checkpoint.iteration;
  }

  /** Create a checkpoint (serializable state for hibernation). */
  checkpoint(agentState: AgentResult | null = null): Checkpoint {
    return {
      id: `ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      graphName: this.config.name,
      currentNode: this.currentNode,
      context: this.context,
      iteration: this.iteration,
      createdAt: new Date().toISOString(),
      agentState,
    };
  }

  /** Advance the graph by one step. Returns false if the graph is complete. */
  async step(): Promise<boolean> {
    const maxIters = this.config.maxIterations ?? 100;
    if (this.iteration >= maxIters) {
      return false;
    }

    const node = this.getNode(this.currentNode);
    if (node === undefined) {
      return false;
    }

    const result = await node.handler(this.context as any);
    this.iteration += 1;

    // Merge context updates
    if (result.contextUpdate !== undefined) {
      Object.assign(this.context, result.contextUpdate);
    }

    // Spawn subagent if requested (Phase 9 — stub)
    if (result.spawnSubagent !== undefined) {
      this.context[`subagent_${result.spawnSubagent.id}`] = {
        prompt: result.spawnSubagent.prompt,
        tools: result.spawnSubagent.tools ?? [],
        status: "pending",
      };
    }

    // Check for terminal output
    if (result.nextNode === null || result.nextNode === undefined) {
      this.context._finalOutput = result.output ?? "";
      return false;
    }

    // Transition to next node via edges
    this.currentNode = result.nextNode;
    return true;
  }

  /** Run the graph to completion. */
  async run(): Promise<{ context: Record<string, unknown>; iteration: number }> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const hasMore = await this.step();
      if (!hasMore) break;
    }
    return { context: this.context, iteration: this.iteration };
  }
}
