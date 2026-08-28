import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

import type { ToolDef, ToolResult, ToolParameters, ToolExecutionContext } from "./types.js";

export interface FileReadParams {
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
}

export const FILE_READ_PARAMETERS: ToolParameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "File path to read. Must be within the working directory.",
    },
    offset: {
      type: "integer",
      description: "1-indexed line number to start reading from. Defaults to 1 (start of file).",
    },
    limit: {
      type: "integer",
      description: "Maximum number of lines to return. Defaults to 200. Large files are capped; use offset+limit to page through.",
    },
  },
  required: ["path"],
  additionalProperties: false,
};

const DEFAULT_LIMIT = 200;
const MAX_TOTAL_BYTES = 100_000;

export const fileReadTool: ToolDef = {
  name: "file_read",
  description:
    "Read a file's contents. Returns up to 200 lines by default (capped at 100KB). " +
    "Use offset and limit to page through large files. " +
    "Paths must be within the working directory.",
  parameters: FILE_READ_PARAMETERS,
  risk: "safe",
  executor: async (params: unknown, context: ToolExecutionContext): Promise<ToolResult> => {
    const workingDir = context.workingDir;
    const validated = validateFileReadParams(params, workingDir);

    const fullPath = resolve(workingDir, validated.path);

    let data: string;
    try {
      const raw = await readFile(fullPath, "utf8");

      if (Buffer.byteLength(raw, "utf8") > MAX_TOTAL_BYTES) {
        const truncated = raw.slice(0, MAX_TOTAL_BYTES);
        const lines = truncated.split("\n");
        data = lines.slice(0, 1000).join("\n");
        return {
          type: "result",
          content: `${data}\n\n[file truncated at ${MAX_TOTAL_BYTES} bytes; use offset+limit to page through]`,
          trusted: true,
          meta: { truncated: true, totalBytes: Buffer.byteLength(raw, "utf8") },
        };
      }

      const allLines = raw.split("\n");
      const start = validated.offset !== undefined ? Math.max(0, validated.offset - 1) : 0;
      const limit = validated.limit ?? DEFAULT_LIMIT;
      const lines = allLines.slice(start, start + limit);
      data = lines.join("\n");

      const hasMore = start + limit < allLines.length;
      if (hasMore) {
        data += `\n\n[showing lines ${start + 1}–${start + lines.length}; ${allLines.length - start - lines.length} more lines available]`;
      }

      return {
        type: "result",
        content: data,
        trusted: true,
        meta: { lineCount: lines.length, hasMore, totalLines: allLines.length },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        content: `Failed to read "${validated.path}": ${message}`,
        trusted: true,
      };
    }
  },
};

function validateFileReadParams(params: unknown, workingDir: string): FileReadParams {
  if (typeof params !== "object" || params === null) {
    throw new Error("file_read: params must be an object");
  }
  const obj = params as Record<string, unknown>;
  const path = obj.path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("file_read: 'path' is required and must be a non-empty string");
  }

  if (!isPathSafe(resolve(workingDir, path), workingDir)) {
    throw new Error(`file_read: path "${path}" is outside the working directory`);
  }

  const offset = typeof obj.offset === "number" ? obj.offset : undefined;
  const limit = typeof obj.limit === "number" ? obj.limit : undefined;

  return {
    path,
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function isPathSafe(targetPath: string, workingDir: string): boolean {
  const rel = relative(resolve(workingDir), resolve(targetPath));
  return !rel.startsWith("..") && !rel.startsWith("/");
}
