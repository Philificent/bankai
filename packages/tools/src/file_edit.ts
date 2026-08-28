import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";

import type { ToolDef, ToolResult, ToolParameters, ToolExecutionContext } from "./types.js";

export type FileEditOperation =
  | { readonly type: "create"; readonly path: string; readonly content: string }
  | {
      readonly type: "replace";
      readonly path: string;
      readonly old_string: string;
      readonly new_string: string;
      readonly replace_all?: boolean;
    }
  | { readonly type: "delete"; readonly path: string };

export interface FileEditParams {
  readonly path: string;
  readonly operation: FileEditOperation;
}

export const FILE_EDIT_PARAMETERS: ToolParameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "File path to edit. Must be within the working directory.",
    },
    operation: {
      type: "object",
      description:
        "The edit to perform. 'create' writes a new file. 'replace' does a string replacement (old_string -> new_string). 'delete' removes the file.",
      properties: {
        type: { type: "string", enum: ["create", "replace", "delete"] },
        old_string: { type: "string", description: "The exact text to replace (replace op only)." },
        new_string: { type: "string", description: "The replacement text (replace op only)." },
        content: { type: "string", description: "File content (create op only)." },
        replace_all: { type: "boolean", description: "Replace all occurrences (replace op only)." },
      },
      required: ["type"],
      additionalProperties: false,
    },
  },
  required: ["path", "operation"],
  additionalProperties: false,
};

export const fileEditTool: ToolDef = {
  name: "file_edit",
  description:
    "Edit a file. Three operations: 'create' writes a new file (parent dirs created), " +
    "'replace' does an exact string replacement (use replace_all to change every occurrence), " +
    "'delete' removes the file. Paths must be within the working directory. " +
    "For 'replace', old_string must be unique unless replace_all is true.",
  parameters: FILE_EDIT_PARAMETERS,
  risk: "requires_approval",
  executor: async (params: unknown, context: ToolExecutionContext): Promise<ToolResult> => {
    const workingDir = context.workingDir;
    const validated = validateFileEditParams(params, workingDir);
    const fullPath = resolve(workingDir, validated.path);

    if (!isPathSafe(fullPath, workingDir)) {
      return {
        type: "error",
        content: `file_edit: path "${validated.path}" is outside the working directory`,
        trusted: true,
      };
    }

    const op = validated.operation;

    try {
      if (op.type === "create") {
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, op.content, "utf8");
        return {
          type: "result",
          content: `Created file "${validated.path}" (${op.content.length} bytes)`,
          trusted: true,
        };
      }

      if (op.type === "delete") {
        const { unlink } = await import("node:fs/promises");
        try {
          await unlink(fullPath);
          return {
            type: "result",
            content: `Deleted file "${validated.path}"`,
            trusted: true,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { type: "error", content: `Failed to delete "${validated.path}": ${msg}`, trusted: true };
        }
      }

      if (op.type === "replace") {
        const current = await readFile(fullPath, "utf8");

        if (op.replace_all) {
          if (!current.includes(op.old_string)) {
            return {
              type: "error",
              content: `file_edit: old_string not found in "${validated.path}"`,
              trusted: true,
            };
          }
          const updated = current.split(op.old_string).join(op.new_string);
          await writeFile(fullPath, updated, "utf8");
          const count = current.split(op.old_string).length - 1;
          return {
            type: "result",
            content: `Replaced ${count} occurrence(s) in "${validated.path}"`,
            trusted: true,
          };
        }

        const count = current.split(op.old_string).length - 1;
        if (count === 0) {
          return {
            type: "error",
            content: `file_edit: old_string not found in "${validated.path}"`,
            trusted: true,
          };
        }
        if (count > 1) {
          return {
            type: "error",
            content: `file_edit: old_string found ${count} times in "${validated.path}" — use replace_all or make it more specific`,
            trusted: true,
          };
        }

        const updated = current.replace(op.old_string, op.new_string);
        await writeFile(fullPath, updated, "utf8");
        return {
          type: "result",
          content: `Replaced 1 occurrence in "${validated.path}"`,
          trusted: true,
        };
      }

      return {
        type: "error",
        content: `file_edit: unknown operation type "${(op as { type: string }).type}"`,
        trusted: true,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        content: `Failed to edit "${validated.path}": ${msg}`,
        trusted: true,
      };
    }
  },
};

function validateFileEditParams(params: unknown, workingDir: string): FileEditParams {
  if (typeof params !== "object" || params === null) {
    throw new Error("file_edit: params must be an object");
  }
  const obj = params as Record<string, unknown>;
  const path = obj.path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("file_edit: 'path' is required and must be a non-empty string");
  }
  const op = obj.operation as Record<string, unknown> | undefined;
  if (typeof op !== "object" || op === null) {
    throw new Error("file_edit: 'operation' is required");
  }

  const opType = op.type;
  if (opType !== "create" && opType !== "replace" && opType !== "delete") {
    throw new Error(`file_edit: operation.type must be 'create', 'replace', or 'delete'`);
  }

  if (!isPathSafe(resolve(workingDir, path), workingDir)) {
    throw new Error(`file_edit: path "${path}" is outside the working directory`);
  }

  if (opType === "create") {
    const content = op.content;
    if (typeof content !== "string") {
      throw new Error("file_edit: create operation requires 'content'");
    }
    return { path, operation: { type: "create", path, content } };
  }

  if (opType === "delete") {
    return { path, operation: { type: "delete", path } };
  }

  const oldString = op.old_string;
  const newString = op.new_string;
  if (typeof oldString !== "string" || oldString.length === 0) {
    throw new Error("file_edit: replace operation requires non-empty 'old_string'");
  }
  if (typeof newString !== "string") {
    throw new Error("file_edit: replace operation requires 'new_string'");
  }

  return {
    path,
    operation: {
      type: "replace",
      path,
      old_string: oldString,
      new_string: newString,
      replace_all: op.replace_all === true,
    },
  };
}

function isPathSafe(targetPath: string, workingDir: string): boolean {
  const rel = relative(resolve(workingDir), resolve(targetPath));
  return !rel.startsWith("..") && !rel.startsWith("/");
}
