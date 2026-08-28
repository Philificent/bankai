/**
 * Skill loader: discovers and parses skills from the skills/ directory.
 *
 * Each skill has a SKILL.md with YAML frontmatter (tier, tools_required, tags)
 * and progressive disclosure tiers. Tier 1 is loaded by default; deeper tiers
 * can be loaded on demand.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface SkillMeta {
  readonly name: string;
  readonly description: string;
  readonly tier: number;
  readonly toolsRequired: readonly string[];
  readonly tags: readonly string[];
}

export interface Skill {
  readonly meta: SkillMeta;
  /** Raw markdown content (without frontmatter). */
  readonly content: string;
  /** Path to the skill directory. */
  readonly path: string;
}

export class SkillLoader {
  private readonly skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = resolve(skillsDir);
  }

  /** Discover all available skills. */
  async list(): Promise<readonly SkillMeta[]> {
    const entries = await this.readSkillsDir();
    const skills: SkillMeta[] = [];

    for (const entry of entries) {
      const meta = await this.parseMeta(entry.path);
      if (meta !== null) {
        skills.push(meta);
      }
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Load a skill by name. */
  async load(name: string): Promise<Skill | null> {
    const meta = await this.loadMeta(name);
    if (meta === null) return null;

    const content = await readFile(join(meta.path, "SKILL.md"), "utf8");
    const { body } = parseFrontmatter(content);

    return {
      meta: {
        name: meta.name,
        description: meta.description,
        tier: meta.tier,
        toolsRequired: meta.toolsRequired,
        tags: meta.tags,
      },
      content: body,
      path: meta.path,
    };
  }

  /** Load a skill's content at a specific tier. */
  async loadTier(name: string, tier: number): Promise<Skill | null> {
    const skill = await this.load(name);
    if (skill === null) return null;
    if (skill.meta.tier > tier) return null;

    // In the full implementation, deeper tiers would be loaded from
    // additional files (tier2.md, tier3.md) within the skill directory.
    // For now, we return the full content.
    return skill;
  }

  private async readSkillsDir(): Promise<{ name: string; path: string }[]> {
    const entries: { name: string; path: string }[] = [];
    try {
      const dirs = await readdir(this.skillsDir);
      for (const dir of dirs) {
        const fullPath = join(this.skillsDir, dir);
        const info = await stat(fullPath);
        if (info.isDirectory()) {
          entries.push({ name: dir, path: fullPath });
        }
      }
    } catch {
      // skills/ directory doesn't exist
    }
    return entries;
  }

  private async parseMeta(skillDir: string): Promise<SkillMeta & { path: string } | null> {
    const skillFile = join(skillDir, "SKILL.md");
    const content = await readFile(skillFile, "utf8").catch(() => null);
    if (content === null) return null;

    const { meta } = parseFrontmatter(content);
    if (typeof meta.name !== "string") return null;

    return {
      name: meta.name,
      description: (meta.description as string) ?? "",
      tier: (meta.tier as number) ?? 1,
      toolsRequired: (meta.tools_required as string[]) ?? [],
      tags: (meta.tags as string[]) ?? [],
      path: skillDir,
    };
  }

  private async loadMeta(name: string): Promise<(SkillMeta & { path: string }) | null> {
    const entries = await this.readSkillsDir();
    for (const entry of entries) {
      const meta = await this.parseMeta(entry.path);
      if (meta !== null && meta.name === name) {
        return meta;
      }
    }
    return null;
  }
}

interface ParsedFrontmatter {
  meta: Record<string, unknown>;
  body: string;
}

/** Minimal YAML frontmatter parser (key: value pairs). */
function parseFrontmatter(content: string): ParsedFrontmatter {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return { meta: {}, body: content };

  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: content };

  const fmContent = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).trim();

  const meta: Record<string, unknown> = {};
  for (const line of fmContent.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value: string = line.slice(idx + 1).trim();

    // Strip quotes and array brackets
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("[") && value.endsWith("]")) {
      // Parse array
      const inner = value.slice(1, -1).trim();
      value = inner;
      const items = inner.split(",").map((s) => s.trim().replace(/['"]/g, ""));
      meta[key] = items;
      continue;
    }

    // Detect numeric values
    const numValue = Number(value);
    if (!Number.isNaN(numValue) && value.trim() !== "") {
      meta[key] = numValue;
    } else {
      meta[key] = value;
    }
  }

  return { meta, body };
}
