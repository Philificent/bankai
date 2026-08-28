import { spawn } from "node:child_process";
import path from "node:path";

import type { ToolDef, ToolResult, ToolParameters, ToolExecutionContext } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 50_000;

export interface BashParams {
  readonly command: string;
  readonly cwd?: string;
  readonly timeout_ms?: number;
}

export const BASH_PARAMETERS: ToolParameters = {
  type: "object",
  properties: {
    command: {
      type: "string",
      description: "The shell command to execute. Runs in bash. Avoid destructive operations; the permission stack will intercept dangerous commands.",
    },
    cwd: {
      type: "string",
      description: "Working directory for the command. Defaults to the agent's workspace.",
    },
    timeout_ms: {
      type: "integer",
      description: `Timeout in milliseconds. Default: ${DEFAULT_TIMEOUT_MS}.`,
    },
  },
  required: ["command"],
  additionalProperties: false,
};

export const bashTool: ToolDef = {
  name: "bash",
  description: `Execute a shell command. Returns stdout, stderr, and exit code. Output is capped at ${MAX_OUTPUT_BYTES} bytes — excess is written to a session log file and a summary is returned. Use for navigation (ls, grep, find, cat), builds, and test runs. Does NOT request approval for each call; the permission stack's deny rules are applied before this tool is ever dispatched.`,
  parameters: BASH_PARAMETERS,
  risk: "safe",
  executor: async (params: unknown, context: ToolExecutionContext): Promise<ToolResult> => {
    const validated = validateBashParams(params);
    const result = await runBash(validated, context.workingDir);

    let content = "";
    if (result.stdout) {
      content += result.stdout;
    }
    if (result.stderr) {
      if (content) content += "\n";
      content += `[stderr] ${result.stderr}`;
    }

    const exitCode = result.exitCode ?? 0;
    if (exitCode !== 0) {
      if (content) content += "\n";
      content += `[exit code: ${exitCode}]`;
    }

    if (result.timedOut) {
      if (content) content += "\n";
      content += `[timed out after ${validated.timeout_ms}ms]`;
    }

    if (result.truncated) {
      if (content) content += "\n";
      content += `[output truncated: ${result.logFile}]`;
    }

    return {
      type: result.exitCode === 0 ? "result" : "error",
      content,
      trusted: true,
      meta: {
        exitCode: result.exitCode ?? 0,
        timedOut: result.timedOut,
        truncated: result.truncated,
        logFile: result.logFile,
      },
    };
  },
};

function validateBashParams(params: unknown): BashParams {
  if (typeof params !== "object" || params === null) {
    throw new Error("bash: params must be an object");
  }
  const obj = params as Record<string, unknown>;
  const command = obj.command;
  if (typeof command !== "string" || command.length === 0) {
    throw new Error("bash: 'command' is required and must be a non-empty string");
  }
  const cwd = typeof obj.cwd === "string" ? obj.cwd : undefined;
  const timeout_ms =
    typeof obj.timeout_ms === "number" ? obj.timeout_ms : DEFAULT_TIMEOUT_MS;

  return {
    command,
    ...(cwd !== undefined ? { cwd } : {}),
    timeout_ms,
  };
}

interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  logFile?: string;
}

function runBash(params: BashParams, workingDir: string): Promise<BashOutput> {
  return new Promise((resolve) => {
    const timeoutMs = Math.max(1, params.timeout_ms ?? DEFAULT_TIMEOUT_MS);
    const cwd = params.cwd ?? workingDir;

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let truncated = false;
    let logFile: string | undefined;

    const child = spawn("bash", ["-c", params.command], {
      cwd,
      signal: undefined,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      if (Buffer.concat(stdoutChunks).length > MAX_OUTPUT_BYTES) {
        if (!truncated) {
          truncated = true;
          logFile = path.join(cwd, ".bankai", `bash-output-${Date.now()}.log`);
          import("node:fs/promises").then(async (fs) => {
            await fs.mkdir(path.dirname(logFile!), { recursive: true });
            await fs.writeFile(logFile!, Buffer.concat(stdoutChunks));
          });
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      if (Buffer.concat(stderrChunks).length > MAX_OUTPUT_BYTES) {
        stderrChunks.length = 0;
        stderr = "[stderr truncated]";
      }
    });

    child.on("error", (err) => {
      resolve({
        stdout,
        stderr: err.message,
        exitCode: 1,
        timedOut,
        truncated,
        ...(logFile !== undefined ? { logFile } : {}),
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);

      stdout = Buffer.concat(stdoutChunks).toString("utf8");
      stderr = Buffer.concat(stderrChunks).toString("utf8");

      resolve({
        stdout,
        stderr,
        exitCode: code,
        timedOut,
        truncated,
        ...(logFile !== undefined ? { logFile } : {}),
      });
    });
  });
}
