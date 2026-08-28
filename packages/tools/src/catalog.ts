import { bashTool } from "./bash.js";
import { fileReadTool } from "./file_read.js";
import { fileEditTool } from "./file_edit.js";
import { codeExecTool } from "./code_exec.js";
import type { ToolDef, ToolCatalog } from "./types.js";

export class DefaultCatalog implements ToolCatalog {
  private readonly byName: Map<string, ToolDef>;
  readonly tools: readonly ToolDef[];

  constructor(tools: readonly ToolDef[] = defaultToolSet()) {
    // Sort by name so the tool list is stable across sessions
    const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    this.tools = sorted;
    this.byName = new Map(sorted.map((t) => [t.name, t]));
  }

  get(name: string): ToolDef | undefined {
    return this.byName.get(name);
  }

  list(): readonly ToolDef[] {
    return this.tools;
  }
}

export function defaultToolSet(): readonly ToolDef[] {
  return [bashTool, fileReadTool, fileEditTool, codeExecTool];
}
