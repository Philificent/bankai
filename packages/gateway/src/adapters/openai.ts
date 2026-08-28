/**
 * OpenAI capability adapter.
 *
 * Projects the harness-native tool catalog and messages into the
 * OpenAI Chat Completions wire format.
 */

import type { ModelRequest, ModelResponse, ProviderToolCall } from "@bankai/core";
import type { ToolDef } from "@bankai/tools";
import type { CapabilityAdapter, ProjectedRequest } from "../types.js";

export class OpenAIAdapter implements CapabilityAdapter {
  readonly provider = "openai" as const;

  async project(request: ModelRequest): Promise<ProjectedRequest> {
    const system = this.extractSystem(request.messages);
    const messages = this.projectMessages(request.messages);
    const tools = this.projectTools(request.tools);

    return { system, messages, tools };
  }

  parseResponse(raw: unknown): Promise<ModelResponse> {
    const data = raw as OpenAIResponse;
    const choice = data.choices?.[0];
    if (choice === undefined) {
      throw new Error("No choices in OpenAI response");
    }

    const msg = choice.message;
    const toolCalls: ProviderToolCall[] = [];

    if (msg.tool_calls !== undefined) {
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

    return Promise.resolve({
      content: msg.content ?? "",
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      stopReason,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    });
  }

  private extractSystem(messages: ModelRequest["messages"]): string {
    const first = messages[0];
    if (first !== undefined && first.role === "system" && first.content !== undefined) {
      return first.content;
    }
    return "";
  }

  private projectMessages(messages: ModelRequest["messages"]): unknown[] {
    const result: unknown[] = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({ role: "system", content: msg.content ?? "" });
      } else if (msg.role === "user") {
        result.push({ role: "user", content: msg.content ?? "" });
      } else if (msg.role === "assistant") {
        const entry: Record<string, unknown> = {
          role: "assistant",
          content: msg.content ?? "",
        };
        if (msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
          entry.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
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

  private projectTools(tools: readonly ToolDef[]): unknown[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
}

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

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}
