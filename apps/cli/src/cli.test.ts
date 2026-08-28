import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "./index.js";

describe("parseArgs", () => {
  it("parses a positional task", () => {
    const opts = parseArgs(["fix the login bug"]);
    assert.equal(opts.task, "fix the login bug");
    assert.equal(opts.model, "coding-primary");
    assert.equal(opts.maxIterations, 50);
    assert.equal(opts.verbose, false);
    assert.equal(opts.dontAsk, false);
  });

  it("parses flag overrides", () => {
    const opts = parseArgs([
      "refactor utils",
      "--model", "gpt-4o",
      "--working-dir", "/tmp/test",
      "--max-iterations", "100",
      "--verbose",
      "--dont-ask",
    ]);
    assert.equal(opts.task, "refactor utils");
    assert.equal(opts.model, "gpt-4o");
    assert.equal(opts.workingDir, "/tmp/test");
    assert.equal(opts.maxIterations, 100);
    assert.equal(opts.verbose, true);
    assert.equal(opts.dontAsk, true);
  });

  it("reads dontAsk from env var", () => {
    const opts = parseArgs(["hello"]);
    assert.equal(opts.dontAsk, false);
  });

  it("throws on missing task", () => {
    assert.throws(() => parseArgs([]), /No task provided/);
  });

  it("throws on missing flag value", () => {
    assert.throws(() => parseArgs(["task", "--model"]), /Missing value for --model/);
  });
});
