import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bashTool, fileReadTool, fileEditTool, codeExecTool, createSandboxedCodeExecTool, DefaultCatalog } from "./index.js";
import type { ToolExecutionContext, ToolResult } from "./types.js";

let workDir: string;

beforeEach(async () => {
  workDir = (await mkdir(join(tmpdir(), `bankai-test-${Date.now()}-${Math.random().toString(36).slice(2)}`), {
    recursive: true,
  })) ?? workDir;
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const ctx = (dir: string): ToolExecutionContext => ({ workingDir: dir });

describe("DefaultCatalog", () => {
  it("lists 4 canonical tools", () => {
    const catalog = new DefaultCatalog();
    const names = catalog.list().map((t) => t.name);
    assert.deepEqual(names, ["bash", "code_exec", "file_edit", "file_read"]);
  });

  it("looks up tools by name", () => {
    const catalog = new DefaultCatalog();
    assert.ok(catalog.get("bash"));
    assert.ok(catalog.get("file_read"));
    assert.ok(catalog.get("file_edit"));
    assert.ok(catalog.get("code_exec"));
  });

  it("returns undefined for unknown tool", () => {
    const catalog = new DefaultCatalog();
    assert.equal(catalog.get("nonexistent"), undefined);
  });
});

describe("bash tool", () => {
  it("runs a simple command", async () => {
    const result: ToolResult = await bashTool.executor({ command: "echo hello" }, ctx(workDir));
    assert.equal(result.type, "result");
    assert.equal(result.content.trim(), "hello");
  });

  it("returns exit code for failing commands", async () => {
    const result: ToolResult = await bashTool.executor({ command: "exit 42" }, ctx(workDir));
    assert.equal(result.type, "error");
    assert.match(result.content, /exit code: 42/);
  });

  it("respects timeout", async () => {
    const result: ToolResult = await bashTool.executor(
      { command: "sleep 5", timeout_ms: 500 },
      ctx(workDir)
    );
    assert.equal(result.type, "error");
    assert.match(result.content, /timed out/);
  });

  it("defaults to working dir", async () => {
    await writeFile(join(workDir, "testfile.txt"), "workspace", "utf8");
    const result: ToolResult = await bashTool.executor(
      { command: "cat testfile.txt" },
      ctx(workDir)
    );
    assert.equal(result.content.trim(), "workspace");
  });
});

describe("file_read tool", () => {
  it("reads a file", async () => {
    await writeFile(join(workDir, "test.txt"), "line1\nline2\nline3", "utf8");
    const result: ToolResult = await fileReadTool.executor({ path: "test.txt" }, ctx(workDir));
    assert.equal(result.type, "result");
    assert.equal(result.content, "line1\nline2\nline3");
  });

  it("rejects paths outside working dir", async () => {
    await assert.rejects(
      () => fileReadTool.executor({ path: "../../etc/passwd" }, ctx(workDir)),
      /outside the working directory/
    );
  });

  it("supports offset and limit", async () => {
    await writeFile(join(workDir, "test.txt"), "a\nb\nc\nd\ne", "utf8");
    const result: ToolResult = await fileReadTool.executor(
      { path: "test.txt", offset: 2, limit: 2 },
      ctx(workDir)
    );
    assert.equal(result.type, "result");
    assert.ok(result.content.startsWith("b\nc"));
    assert.match(result.content, /more lines available/);
  });
});

describe("file_edit tool", () => {
  it("creates a file", async () => {
    const result: ToolResult = await fileEditTool.executor(
      {
        path: "newfile.txt",
        operation: { type: "create", path: "newfile.txt", content: "hello" },
      },
      ctx(workDir)
    );
    assert.equal(result.type, "result");
    assert.match(result.content, /Created/);
  });

  it("replaces text in a file", async () => {
    await writeFile(join(workDir, "test.txt"), "hello world", "utf8");
    const result: ToolResult = await fileEditTool.executor(
      {
        path: "test.txt",
        operation: {
          type: "replace",
          path: "test.txt",
          old_string: "hello",
          new_string: "goodbye",
        },
      },
      ctx(workDir)
    );
    assert.equal(result.type, "result");

    const readResult: ToolResult = await fileReadTool.executor({ path: "test.txt" }, ctx(workDir));
    assert.equal(readResult.content, "goodbye world");
  });

  it("errors when old_string not found", async () => {
    await writeFile(join(workDir, "test.txt"), "hello world", "utf8");
    const result: ToolResult = await fileEditTool.executor(
      {
        path: "test.txt",
        operation: {
          type: "replace",
          path: "test.txt",
          old_string: "notfound",
          new_string: "x",
        },
      },
      ctx(workDir)
    );
    assert.equal(result.type, "error");
    assert.match(result.content, /not found/);
  });
});

describe("code_exec tool", () => {
  it("runs JavaScript", async () => {
    const result: ToolResult = await codeExecTool.executor(
      { code: "console.log(42)" },
      ctx(workDir)
    );
    assert.equal(result.type, "result");
    assert.match(result.content, /42/);
  });

  it("runs bash via code_exec", async () => {
    const result: ToolResult = await codeExecTool.executor(
      { code: "echo from_bash", language: "bash" },
      ctx(workDir)
    );
    assert.equal(result.type, "result");
    assert.match(result.content, /from_bash/);
  });

  it("createSandboxedCodeExecTool returns a tool with correct metadata", () => {
    const tool = createSandboxedCodeExecTool("/tmp");
    assert.equal(tool.name, "code_exec");
    assert.equal(tool.risk, "safe");
    assert.ok(tool.description.includes("Docker"));
  });
});
