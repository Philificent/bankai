/**
 * Verification middleware for Bankai.
 *
 * Phase 6: "Verification is external." The agent cannot declare done
 * by re-reading its own diff. This module runs deterministic checks
 * (typecheck, test) and returns structured results.
 *
 * Integration: the harness wraps these as a "verify" tool that the agent
 * calls before declaring a task complete.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

export interface VerificationResult {
  readonly check: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly output: string;
  readonly error?: string;
}

export interface VerificationReport {
  readonly allPassed: boolean;
  readonly results: readonly VerificationResult[];
  readonly durationMs: number;
}

export interface VerifierConfig {
  readonly projectRoot: string;
  readonly checks: readonly VerificationCheck[];
}

export interface VerificationCheck {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

const DEFAULT_CHECKS: readonly VerificationCheck[] = [
  {
    name: "typecheck",
    command: "pnpm",
    args: ["check"],
  },
  {
    name: "test",
    command: "pnpm",
    args: ["test"],
  },
];

export class Verifier {
  private readonly config: VerifierConfig;

  constructor(config: VerifierConfig) {
    this.config = config;
  }

  static defaults(projectRoot: string): Verifier {
    return new Verifier({
      projectRoot: resolve(projectRoot),
      checks: DEFAULT_CHECKS,
    });
  }

  async verify(): Promise<VerificationReport> {
    const start = Date.now();
    const results: VerificationResult[] = [];

    for (const check of this.config.checks) {
      const result = await this.runCheck(check);
      results.push(result);
    }

    return {
      allPassed: results.every((r) => r.passed),
      results,
      durationMs: Date.now() - start,
    };
  }

  private runCheck(check: VerificationCheck): Promise<VerificationResult> {
    return new Promise((resolve) => {
      const start = Date.now();
      const cwd = check.cwd ?? this.config.projectRoot;

      const child = spawn(check.command, [...check.args], {
        stdio: ["pipe", "pipe", "pipe"],
        cwd,
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

      child.on("error", (err) => {
        resolve({
          check: check.name,
          passed: false,
          durationMs: Date.now() - start,
          output: "",
          error: err.message,
        });
      });

      child.on("close", (code: number | null) => {
        const stdoutStr = Buffer.concat(stdout).toString("utf8").slice(0, 5000);
        const stderrStr = Buffer.concat(stderr).toString("utf8").slice(0, 5000);
        resolve({
          check: check.name,
          passed: code === 0,
          durationMs: Date.now() - start,
          output: stdoutStr,
          ...(stderrStr ? { error: stderrStr } : {}),
        });
      });
    });
  }
}
