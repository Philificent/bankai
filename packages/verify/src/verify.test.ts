import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Verifier } from "./index.js";

describe("Verifier", () => {
  it("creates default verifier from project root", () => {
    const verifier = Verifier.defaults("/Users/phil/projects/bankai");
    assert.ok(verifier);
  });

  it("runs checks and returns a report", async () => {
    const verifier = new Verifier({
      projectRoot: "/Users/phil/projects/bankai",
      checks: [
        {
          name: "echo-test",
          command: "echo",
          args: ["hello"],
        },
      ],
    });

    const report = await verifier.verify();
    assert.equal(report.allPassed, true);
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0]!.check, "echo-test");
    assert.equal(report.results[0]!.passed, true);
    assert.match(report.results[0]!.output, /hello/);
  });

  it("detects failing checks", async () => {
    const verifier = new Verifier({
      projectRoot: "/Users/phil/projects/bankai",
      checks: [
        {
          name: "fail-test",
          command: "node",
          args: ["-e", "process.exit(1)"],
        },
      ],
    });

    const report = await verifier.verify();
    assert.equal(report.allPassed, false);
    assert.equal(report.results[0]!.passed, false);
  });
});
