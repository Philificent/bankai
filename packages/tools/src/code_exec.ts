import { spawn } from "node:child_process";

import type { ToolDef, ToolResult, ToolParameters, ToolExecutionContext } from "./types.js";

/**
 * Code execution sandbox placeholder.
 *
 * Phase 1: runs Node.js in a child process with restricted flags.
 * Phase 3+: container-based isolation (workspace-write only, no network egress).
 * Phase 10: replace with ephemeral container per task.
 */

export interface CodeExecParams {
  readonly code: string;
  readonly language?: "typescript" | "javascript" | "python" | "bash";
  readonly timeout_ms?: number;
}

export const CODE_EXEC_PARAMETERS: ToolParameters = {
  type: "object",
  properties: {
    code: {
      type: "string",
      description: "The code to execute.",
    },
    language: {
      type: "string",
      enum: ["typescript", "javascript", "python", "bash"],
      description: "Language to run. Default: typescript (executed via tsx/esm loader).",
    },
    timeout_ms: {
      type: "integer",
      description: "Max execution time in ms. Default: 10000.",
    },
  },
  required: ["code"],
  additionalProperties: false,
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 50_000;

export const codeExecTool: ToolDef = {
  name: "code_exec",
  description:
    "Execute code in a sandboxed environment. Supports TypeScript, JavaScript, Python, and Bash. " +
    "The sandbox has workspace-read/write access only — no network egress, no real credentials " +
    "(dummy env values only). Output is capped at 50KB. " +
    "Use this for computations, data filtering, and scripting over tool outputs.",
  parameters: CODE_EXEC_PARAMETERS,
  risk: "safe",
  executor: async (params: unknown, _context: ToolExecutionContext): Promise<ToolResult> => {
    const validated = validateCodeExecParams(params);

    switch (validated.language) {
      case "bash":
        return runBash(validated.code, validated.timeout_ms);
      case "python":
        return runPython(validated.code, validated.timeout_ms);
      case "javascript":
        return runNode("js", validated.code, validated.timeout_ms);
      case "typescript":
      default:
        return runNode("ts", validated.code, validated.timeout_ms);
    }
  },
};

function validateCodeExecParams(params: unknown): Required<Omit<CodeExecParams, "language">> &
  Pick<CodeExecParams, "language"> {
  if (typeof params !== "object" || params === null) {
    throw new Error("code_exec: params must be an object");
  }
  const obj = params as Record<string, unknown>;
  const code = obj.code;
  if (typeof code !== "string" || code.length === 0) {
    throw new Error("code_exec: 'code' is required and must be a non-empty string");
  }
  const language: CodeExecParams["language"] =
    (typeof obj.language === "string" ? (obj.language as CodeExecParams["language"]) : undefined) ??
    "typescript";
  const timeout_ms =
    typeof obj.timeout_ms === "number" ? obj.timeout_ms : DEFAULT_TIMEOUT_MS;

  return { code, language, timeout_ms };
}

interface ExecOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

function runCommand(
  cmd: string[],
  code: string,
  timeout_ms: number
): Promise<ExecOutput> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0]!, [...cmd.slice(1)!, code], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Dummy secrets — the real proxy injects real values at runtime
        API_KEY: "dummy",
        SECRET_KEY: "dummy",
        DATABASE_URL: "dummy",
        NODE_ENV: "production",
      },
      timeout: timeout_ms,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      if (Buffer.concat(stdoutChunks).length > MAX_OUTPUT_BYTES) {
        stdoutChunks.length = 0;
        stdoutChunks.push(Buffer.from("[output truncated]"));
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      if (Buffer.concat(stderrChunks).length > MAX_OUTPUT_BYTES) {
        stderrChunks.length = 0;
        stderrChunks.push(Buffer.from("[stderr truncated]"));
      }
    });

    child.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
        timedOut,
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout_ms);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}

function runBash(code: string, timeout_ms: number): Promise<ToolResult> {
  return runCommand(["bash", "-c"], code, timeout_ms).then(formatResult);
}

function runPython(code: string, timeout_ms: number): Promise<ToolResult> {
  return runCommand(["python3"], code, timeout_ms).then(formatResult);
}

function runNode(lang: "js" | "ts", code: string, timeout_ms: number): Promise<ToolResult> {
  if (lang === "ts") {
    // Use --input-type=module for TS-like ESM; full tsx loader comes in Phase 3
    return new Promise((resolve) => {
      const child = spawn("node", ["--input-type=module", "--eval", code], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          API_KEY: "dummy",
          SECRET_KEY: "dummy",
          DATABASE_URL: "dummy",
        },
        timeout: timeout_ms,
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let timedOut = false;

      child.stdout?.on("data", (c: Buffer) => stdout.push(c));
      child.stderr?.on("data", (c: Buffer) => stderr.push(c));

      child.on("error", (err) => {
        resolve({
          type: "error",
          content: err.message,
          trusted: true,
        });
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeout_ms);

      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        const out = Buffer.concat(stdout).toString("utf8");
        const err = Buffer.concat(stderr).toString("utf8");
        let content = out;
        if (err) content += (content ? "\n" : "") + err;
        if (code !== 0 && !content) content = `[exit code: ${code}]`;
        if (timedOut) content += (content ? "\n" : "") + `[timed out after ${timeout_ms}ms]`;
        resolve({
          type: code === 0 ? "result" : "error",
          content,
          trusted: true,
          meta: { exitCode: code ?? 0, timedOut },
        });
      });
    });
  }

  return runCommand(["node"], code, timeout_ms).then(formatResult);
}

function formatResult(out: ExecOutput): ToolResult {
  let content = out.stdout;
  if (out.stderr) {
    if (content) content += "\n";
    content += out.stderr;
  }
  if (out.exitCode !== 0) {
    if (content) content += "\n";
    content += `[exit code: ${out.exitCode}]`;
  }
  if (out.timedOut) {
    if (content) content += "\n";
    content += `[timed out]`;
  }

  return {
    type: out.exitCode === 0 ? "result" : "error",
    content,
    trusted: true,
    meta: { exitCode: out.exitCode ?? 0, timedOut: out.timedOut },
  };
}
