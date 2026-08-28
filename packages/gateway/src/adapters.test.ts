import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { OpenAIAdapter } from "./adapters/openai.js";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import type { ModelRequest } from "@bankai/core";
import type { ToolDef } from "@bankai/tools";

const TEST_TOOLS: readonly ToolDef[] = [
  {
    name: "bash",
    description: "Run a shell command",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to run" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    risk: "safe",
    executor: async () => ({ type: "result", content: "", trusted: true }),
  },
];

const SYSTEM_MSG: ModelRequest["messages"] = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "Hello" },
];

describe("OpenAI adapter", () => {
  const adapter = new OpenAIAdapter();

  it("projects tools to OpenAI function format", async () => {
    const result = await adapter.project({
      messages: SYSTEM_MSG,
      tools: TEST_TOOLS,
      model: "gpt-4o",
    });

    const tools = result.tools as Array<{ type: string; function: { name: string } }>;
    assert.equal(tools[0]!.type, "function");
    assert.equal(tools[0]!.function.name, "bash");
  });

  it("extracts system prompt and includes it in messages", async () => {
    const result = await adapter.project({
      messages: SYSTEM_MSG,
      tools: TEST_TOOLS,
      model: "gpt-4o",
    });

    assert.equal(result.system, "You are a helpful assistant.");
    const messages = result.messages as Array<{ role: string }>;
    assert.equal(messages[0]!.role, "system");
    assert.equal(messages[1]!.role, "user");
  });

  it("parses OpenAI response with tool calls", async () => {
    const raw = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "Let me run a command",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: { name: "bash", arguments: '{"command":"echo hello"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
          index: 0,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };

    const response = await adapter.parseResponse(raw);
    assert.equal(response.content, "Let me run a command");
    assert.ok(response.toolCalls);
    assert.equal(response.toolCalls![0]!.name, "bash");
    assert.equal(response.toolCalls![0]!.arguments.command, "echo hello");
    assert.equal(response.stopReason, "tool_use");
    assert.equal(response.usage.inputTokens, 10);
    assert.equal(response.usage.outputTokens, 20);
  });
});

describe("Anthropic adapter", () => {
  const adapter = new AnthropicAdapter();

  it("projects tools to Anthropic input_schema format", async () => {
    const result = await adapter.project({
      messages: SYSTEM_MSG,
      tools: TEST_TOOLS,
      model: "claude-3-5-sonnet-20241022",
    });

    const tools = result.tools as Array<{ name: string; input_schema: { type: string } }>;
    assert.equal(tools[0]!.name, "bash");
    assert.equal(tools[0]!.input_schema.type, "object");
  });

  it("extracts system as separate parameter (not in messages)", async () => {
    const result = await adapter.project({
      messages: [
        { role: "system", content: "You are a coding agent." },
        { role: "user", content: "Fix the bug" },
      ],
      tools: TEST_TOOLS,
      model: "claude-3-5-sonnet-20241022",
    });

    assert.equal(result.system, "You are a coding agent.");
    const messages = result.messages as Array<{ role: string }>;
    // System message should be skipped (Anthropic uses top-level system param)
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.role, "user");
  });

  it("preserves thinking blocks in assistant messages", async () => {
    const messages: ModelRequest["messages"] = [
      { role: "system", content: "You are a coding agent." },
      { role: "user", content: "Fix the bug" },
      {
        role: "assistant",
        content: "Let me think",
        thinking: [{ type: "thinking", thinking: "I need to look at the code", signature: "sig123" }],
        toolCalls: [{ id: "toolu_1", name: "bash", arguments: { command: "ls" } }],
      },
      { role: "tool", toolCallId: "toolu_1", content: "src/" },
    ];

    const result = await adapter.project({
      messages,
      tools: TEST_TOOLS,
      model: "claude-3-5-sonnet-20241022",
    });

    const assistantMsg = result.messages[1] as {
      role: string;
      content: Array<{ type: string; [key: string]: unknown }>;
    };

    // Thinking block should be first
    assert.equal(assistantMsg.content[0]!.type, "thinking");
    assert.equal(assistantMsg.content[0]!.thinking, "I need to look at the code");
    assert.equal(assistantMsg.content[0]!.signature, "sig123");

    // Tool result should be a user message with tool_result block
    const toolResultMsg = result.messages[2] as {
      role: string;
      content: Array<{ type: string; tool_use_id: string }>;
    };
    assert.equal(toolResultMsg.role, "user");
    assert.equal(toolResultMsg.content[0]!.type, "tool_result");
    assert.equal(toolResultMsg.content[0]!.tool_use_id, "toolu_1");
  });

  it("parses Anthropic response with thinking and tool_use blocks", async () => {
    const raw = {
      content: [
        { type: "thinking", thinking: "I should check the file system", signature: "sig_abc" },
        { type: "redacted_thinking", data: "redacted_data_here" },
        { type: "text", text: "I see the issue." },
        { type: "tool_use", id: "toolu_9", name: "bash", input: { command: "ls" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 50, output_tokens: 60 },
    };

    const response = await adapter.parseResponse(raw);
    assert.equal(response.content, "I see the issue.");

    // Thinking should be preserved
    assert.ok(response.thinking);
    assert.equal(response.thinking![0]!.thinking, "I should check the file system");
    assert.equal(response.thinking![0]!.signature, "sig_abc");

    // Redacted thinking should be preserved
    assert.ok(response.redactedThinking);
    assert.equal(response.redactedThinking![0]!.data, "redacted_data_here");

    // Tool calls should be parsed
    assert.ok(response.toolCalls);
    assert.equal(response.toolCalls![0]!.id, "toolu_9");
    assert.equal(response.toolCalls![0]!.name, "bash");
    assert.equal(response.toolCalls![0]!.arguments.command, "ls");

    assert.equal(response.stopReason, "tool_use");
    assert.equal(response.usage.inputTokens, 50);
    assert.equal(response.usage.outputTokens, 60);
    assert.equal(response.usage.totalTokens, 110);
  });

  it("parses Anthropic response with end_turn", async () => {
    const raw = {
      content: [{ type: "text", text: "Done!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    const response = await adapter.parseResponse(raw);
    assert.equal(response.content, "Done!");
    assert.equal(response.stopReason, "end_turn");
    assert.equal(response.toolCalls, undefined);
    assert.equal(response.thinking, undefined);
  });
});
