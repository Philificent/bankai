import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "./index.js";

describe("parseArgs", () => {
  it("parses a positional task", () => {
    const opts = parseArgs(["fix the login bug"]);
    assert.equal(opts.task, "fix the login bug");
    assert.equal(opts.model, "gpt-4o");
    assert.equal(opts.maxIterations, 50);
    assert.equal(opts.verbose, false);
  });

  it("parses flag overrides", () => {
    const opts = parseArgs([
      "refactor utils",
      "--model", "claude-4",
      "--working-dir", "/tmp/test",
      "--max-iterations", "100",
      "--verbose",
    ]);
    assert.equal(opts.task, "refactor utils");
    assert.equal(opts.model, "claude-4");
    assert.equal(opts.workingDir, "/tmp/test");
    assert.equal(opts.maxIterations, 100);
    assert.equal(opts.verbose, true);
  });

  it("reads from env vars", () => {
    const orig = process.env.BANKAI_API_KEY;
    process.env.BANKAI_API_KEY = "env-key-123";
    try {
      const opts = parseArgs(["hello"]);
      assert.equal(opts.apiKey, "env-key-123");
    } finally {
      if (orig === undefined) {
        delete process.env.BANKAI_API_KEY;
      } else {
        process.env.BANKAI_API_KEY = orig;
      }
    }
  });

  it("flags override env vars", () => {
    const orig = process.env.BANKAI_API_KEY;
    process.env.BANKAI_API_KEY = "env-key";
    try {
      const opts = parseArgs(["hello", "--api-key", "flag-key"]);
      assert.equal(opts.apiKey, "flag-key");
    } finally {
      if (orig === undefined) {
        delete process.env.BANKAI_API_KEY;
      } else {
        process.env.BANKAI_API_KEY = orig;
      }
    }
  });

  it("throws on missing task", () => {
    assert.throws(() => parseArgs([]), /No task provided/);
  });

  it("throws on missing flag value", () => {
    assert.throws(() => parseArgs(["task", "--model"]), /Missing value for --model/);
  });
});
