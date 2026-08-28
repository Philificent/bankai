/**
 * Minimal OpenAI-compatible model provider for Phase 1.
 *
 * Phase 3 replaces this with the LiteLLM gateway adapter + per-provider
 * capability translation. For now, this is enough to run end-to-end.
 */

import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderToolCall,
  ModelMessage,
} from "@bankai/core";
import type { ToolDef } from "@bankai/tools";

export interface OpenAIProviderConfig {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly model: string;
  readonly costPer1MInput?: number;
  readonly costPer1MOutput?: number;
}

export class OpenAIProvider implements ModelProvider {
  private readonly config: OpenAIProviderConfig;

  constructor(config: OpenAIProviderConfig) {
    this.config = config;
  }

  costFor(usage: { inputTokens: number; outputTokens: number }): number {
    const inputCost =
      (this.config.costPer1MInput ?? 3.0) * (usage.inputTokens / 1_000_000);
    const outputCost =
      (this.config.costPer1MOutput ?? 15.0) * (usage.outputTokens / 1_000_000);
    return inputCost + outputCost;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const body = {
      model: this.config.model,
      messages: this.toOpenAIMessages(request.messages),
      tools: this.toOpenAITools(request.tools),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    };

    const resp = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI API error ${resp.status}: ${text.slice(0, 500)}`);
    }

    const data = (await resp.json()) as OpenAIResponse;

    const choice = data.choices[0];
    if (choice === undefined) {
      throw new Error("No choices in OpenAI response");
    }

    const msg = choice.message;
    const toolCalls: ProviderToolCall[] = [];

    if (msg.role === "assistant" && msg.tool_calls !== undefined) {
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = { _raw: tc.function.arguments };
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });
      }
    }

    const stopReason: ModelResponse["stopReason"] =
      toolCalls.length > 0
        ? "tool_use"
        : choice.finish_reason === "stop"
          ? "end_turn"
          : choice.finish_reason === "length"
            ? "max_tokens"
            : "end_turn";

    return {
      content: msg.content ?? "",
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      stopReason,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    };
  }

  private toOpenAIMessages(messages: readonly ModelMessage[]): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({ role: "system", content: msg.content ?? "" });
      } else if (msg.role === "user") {
        result.push({ role: "user", content: msg.content ?? "" });
      } else if (msg.role === "assistant") {
        const entry: OpenAIAssistantMessage = { role: "assistant", content: msg.content ?? "" };
        if (msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
          entry.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }));
        }
        result.push(entry);
      } else if (msg.role === "tool") {
        result.push({
          role: "tool",
          tool_call_id: msg.toolCallId ?? "",
          content: msg.content ?? "",
        });
      }
    }
    return result;
  }

  private toOpenAITools(tools: readonly ToolDef[]) {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
}

// --- OpenAI wire format types (internal) ---

interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIChoice {
  message: OpenAIMessage;
  finish_reason: string;
  index: number;
}

type OpenAIMessage =
  | OpenAISystemMessage
  | OpenAIUserMessage
  | OpenAIAssistantMessage
  | OpenAIToolMessage;

interface OpenAISystemMessage {
  role: "system";
  content: string;
}

interface OpenAIUserMessage {
  role: "user";
  content: string;
}

interface OpenAIAssistantMessage {
  role: "assistant";
  content: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

