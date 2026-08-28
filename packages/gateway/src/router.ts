/**
 * Gateway router: resolves model aliases, selects the right capability adapter,
 * makes HTTP calls with retry/fallback, and tracks budget.
 *
 * Implements ModelProvider so it slots into the agent loop transparently.
 */

import { setTimeout as sleep } from "node:timers/promises";

import type { ModelProvider, ModelRequest, ModelResponse } from "@bankai/core";
import type {
  AsyncBudgetTracker,
  CapabilityAdapter,
  GatewayConfig,
  ModelAlias,
  BudgetTracker,
  ProviderName,
} from "./types.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { InMemoryBudgetTracker } from "./budget.js";

export class GatewayRouter implements ModelProvider {
  private readonly config: GatewayConfig;
  private readonly adapters: Map<string, CapabilityAdapter>;
  private readonly budget: BudgetTracker;
  private readonly asyncBudget: AsyncBudgetTracker | undefined;
  private readonly aliasMap: Map<string, ModelAlias>;

  constructor(config: GatewayConfig, budget?: BudgetTracker, asyncBudget?: AsyncBudgetTracker) {
    this.config = config;
    this.budget = budget ?? new InMemoryBudgetTracker(config.budget);
    this.asyncBudget = asyncBudget;

    // Build alias lookup
    this.aliasMap = new Map(config.aliases.map((a) => [a.name, a]));

    // Register adapters
    this.adapters = new Map();
    this.adapters.set("openai", new OpenAIAdapter());
    this.adapters.set("openai-compatible", new OpenAIAdapter());
    this.adapters.set("anthropic", new AnthropicAdapter());
  }

  costFor(usage: { inputTokens: number; outputTokens: number }): number {
    // Estimate cost based on the last-used model's pricing.
    // In production, the gateway would track which model was used.
    const alias = this.aliasMap.get(this.config.aliases[0]!.name);
    if (alias === undefined) {
      return 0;
    }
    const cost =
      (alias.costPer1MInputUSD * usage.inputTokens) / 1_000_000 +
      (alias.costPer1MOutputUSD * usage.outputTokens) / 1_000_000;
    return cost;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    // Check budget before the call (use async tracker if available)
    let budgetCheck;
    if (this.asyncBudget !== undefined) {
      budgetCheck = await this.asyncBudget.check();
    } else {
      budgetCheck = this.budget.check();
    }
    if (budgetCheck.exceeded) {
      throw new Error(`Budget exceeded: ${budgetCheck.reason}`);
    }

    // Resolve the model alias
    const alias = this.resolveAlias(request);

    // Apply per-model tool profiles (Phase 10): filter tools to only
    // those allowed for this model alias
    let tools = request.tools;
    const profile = this.config.toolProfiles?.[alias.name];
    if (profile !== undefined && profile.length > 0) {
      const allowed = new Set(profile);
      tools = request.tools.filter((t: { name: string }) => allowed.has(t.name));
    }

    // Apply per-model prompt profile (Phase 10): override system prompt
    let messages = request.messages;
    const promptOverride = this.config.promptProfiles?.[alias.name];
    if (promptOverride !== undefined && promptOverride.length > 0) {
      messages = request.messages.map((m) => {
        if (m.role === "system") {
          return { ...m, content: promptOverride };
        }
        return m;
      });
    }

    // Get the adapter for this provider
    const adapter = this.adapters.get(alias.provider);
    if (adapter === undefined) {
      throw new Error(`No adapter registered for provider: ${alias.provider}`);
    }

    // Project the request into the provider's wire format
    const projected = await adapter.project({
      ...request,
      tools,
      messages,
    });

    // Make the API call with retries
    const response = await this.callWithRetry(alias, adapter, projected, request);

    // Charge the budget (use async tracker if available)
    const cost = this.estimateCost(alias, response.usage);
    if (this.asyncBudget !== undefined) {
      await this.asyncBudget.charge(response.usage, cost);
    } else {
      this.budget.charge(response.usage, cost);
    }

    return response;
  }

  private resolveAlias(request: ModelRequest): ModelAlias {
    const modelName = request.model ?? this.config.aliases[0]!.name;
    const alias = this.aliasMap.get(modelName);
    if (alias !== undefined) {
      return alias;
    }

    // Not a known alias — try to infer provider from the model name
    const inferred = this.inferProvider(modelName);
    return {
      name: modelName,
      provider: inferred,
      model: modelName,
      costPer1MInputUSD: inferred === "anthropic" ? 15.0 : 3.0,
      costPer1MOutputUSD: inferred === "anthropic" ? 75.0 : 15.0,
    };
  }

  private inferProvider(modelName: string): ProviderName {
    if (modelName.startsWith("claude")) {
      return "anthropic";
    }
    return "openai";
  }

  private async callWithRetry(
    alias: ModelAlias,
    adapter: CapabilityAdapter,
    projected: Awaited<ReturnType<CapabilityAdapter["project"]>>,
    request: ModelRequest
  ): Promise<ModelResponse> {
    const maxAttempts = this.config.retry.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const raw = await this.makeApiCall(alias, projected, request);
        const response = await adapter.parseResponse(raw);
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isRetryable = this.isRetryableError(message);

        if (!isRetryable || attempt === maxAttempts - 1) {
          if (attempt === maxAttempts - 1) {
            throw new Error(
              `Gateway failed after ${maxAttempts} attempts for ${alias.provider}/${alias.model}: ${message}`
            );
          }
          throw err;
        }

        // Exponential backoff before retry
        const backoff = this.config.retry.baseBackoffMs * Math.pow(2, attempt);
        await sleep(backoff);
      }
    }

    throw new Error("Gateway exhausted all retries");
  }

  private async makeApiCall(
    alias: ModelAlias,
    projected: Awaited<ReturnType<CapabilityAdapter["project"]>>,
    request: ModelRequest
  ): Promise<unknown> {
    const apiKey = this.config.apiKeys[alias.provider] ?? "";
    const baseURL = this.config.baseURLs[alias.provider] ?? "";

    if (alias.provider === "anthropic") {
      const body: Record<string, unknown> = {
        model: alias.model,
        system: projected.system || undefined,
        messages: projected.messages,
        tools: projected.tools as unknown,
        max_tokens: request.maxTokens ?? 4096,
      };
      // Strip undefined system
      if (body.system === undefined) {
        delete body.system;
      }

      const resp = await fetch(`${baseURL}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        throw new Error(`Anthropic API error ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      }

      return resp.json();
    }

    // OpenAI / OpenAI-compatible
    const body: Record<string, unknown> = {
      model: alias.model,
      messages: projected.messages,
      tools: projected.tools as unknown,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    };

    // Include system in messages (OpenAI supports role: "system")
    if (projected.system) {
      // The system is already in the projected messages for OpenAI
    }

    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`OpenAI API error ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }

    return resp.json();
  }

  private isRetryableError(message: string): boolean {
    const retryablePatterns = [
      /rate limit/i,
      /429/,
      /timeout/i,
      /internal server error/i,
      /502/,
      /503/,
      /504/,
    ];
    return retryablePatterns.some((p) => p.test(message));
  }

  private estimateCost(
    alias: ModelAlias,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  ): number {
    return (
      (alias.costPer1MInputUSD * usage.inputTokens) / 1_000_000 +
      (alias.costPer1MOutputUSD * usage.outputTokens) / 1_000_000
    );
  }

  get spentUSD(): number {
    return this.asyncBudget?.spentUSD ?? this.budget.spentUSD;
  }

  get spentTokens(): number {
    return this.asyncBudget?.spentTokens ?? this.budget.spentTokens;
  }
}
