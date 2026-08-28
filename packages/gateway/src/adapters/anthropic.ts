/**
 * Anthropic capability adapter.
 *
 * Projects the harness-native tool catalog and messages into the
 * Anthropic Messages API wire format. Key concerns from the report:
 *
 * - Thinking / redacted_thinking blocks must be passed back unmodified
 *   with the tool results they accompanied.
 * - Tools use input_schema, not JSON Schema parameters.
 * - System prompt is a separate top-level parameter.
 * - Tool results are user messages with tool_result content blocks.
 */

import type {
  ModelRequest,
  ModelResponse,
  ModelMessage,
  ProviderToolCall,
  ThinkingBlock,
  RedactedThinkingBlock,
} from "@bankai/core";
import type { ToolDef } from "@bankai/tools";
import type { CapabilityAdapter, ProjectedRequest } from "../types.js";

export class AnthropicAdapter implements CapabilityAdapter {
  readonly provider = "anthropic" as const;

  async project(request: ModelRequest): Promise<ProjectedRequest> {
    const system = this.extractSystem(request.messages);
    const messages = this.projectMessages(request.messages);
    const tools = this.projectTools(request.tools);

    return { system, messages, tools };
  }

  parseResponse(raw: unknown): Promise<ModelResponse> {
    const data = raw as AnthropicResponse;

    const toolCalls: ProviderToolCall[] = [];
    let content = "";
    const thinking: ThinkingBlock[] = [];
    const redactedThinking: RedactedThinkingBlock[] = [];

    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === "text") {
          content += block.text;
        } else if (block.type === "thinking") {
          thinking.push({
            type: "thinking",
            thinking: block.thinking,
            ...(block.signature !== undefined ? { signature: block.signature } : {}),
          });
        } else if (block.type === "redacted_thinking") {
          redactedThinking.push({
            type: "redacted_thinking",
            data: block.data,
          });
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input ?? {},
          });
        }
      }
    }

    const stopReason: ModelResponse["stopReason"] =
      toolCalls.length > 0
        ? "tool_use"
        : data.stop_reason === "end_turn"
          ? "end_turn"
          : data.stop_reason === "max_tokens"
            ? "max_tokens"
            : "end_turn";

    return Promise.resolve({
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      stopReason,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      ...(thinking.length > 0 ? { thinking } : {}),
      ...(redactedThinking.length > 0 ? { redactedThinking } : {}),
    });
  }

  private extractSystem(messages: readonly ModelMessage[]): string {
    // Anthropic expects the system prompt as a separate parameter.
    // We take it from the first system message.
    const first = messages[0];
    if (first !== undefined && first.role === "system" && first.content !== undefined) {
      return first.content;
    }
    return "";
  }

  private projectMessages(messages: readonly ModelMessage[]): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        // System messages are extracted separately; skip in the message list.
        continue;
      }

      if (msg.role === "user") {
        result.push({
          role: "user",
          content: [{ type: "text", text: msg.content ?? "" }],
        });
      } else if (msg.role === "assistant") {
        const content: Record<string, unknown>[] = [];

        // Preserve thinking blocks unmodified
        if (msg.thinking !== undefined) {
          for (const tb of msg.thinking) {
            content.push({
              type: "thinking",
              thinking: tb.thinking,
              ...(tb.signature !== undefined ? { signature: tb.signature } : {}),
            });
          }
        }
        if (msg.redactedThinking !== undefined) {
          for (const rt of msg.redactedThinking) {
            content.push({
              type: "redacted_thinking",
              data: rt.data,
            });
          }
        }

        // Text content
        if (msg.content !== undefined && msg.content.length > 0) {
          content.push({ type: "text", text: msg.content });
        }

        // Tool calls
        if (msg.toolCalls !== undefined) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }

        result.push({ role: "assistant", content });
      } else if (msg.role === "tool") {
        result.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId ?? "",
              content: msg.content ?? "",
              is_error: msg.content !== undefined && false,
            },
          ],
        });
      }
    }
    return result;
  }

  private projectTools(tools: readonly ToolDef[]): Record<string, unknown>[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object",
        properties: t.parameters.properties,
        required: t.parameters.required,
        ...(t.parameters.additionalProperties !== undefined
          ? { additionalProperties: t.parameters.additionalProperties }
          : {}),
      },
    }));
  }
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
