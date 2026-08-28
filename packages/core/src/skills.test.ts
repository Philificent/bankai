import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SkillLoader } from "./skills.js";

let testDir: string;

before(async () => {
  testDir = (await mkdir(
    join(tmpdir(), `bankai-skills-test-${Date.now()}`),
    { recursive: true }
  )) ?? "";

  // Create test skills
  await mkdir(join(testDir, "skill-a"), { recursive: true });
  await writeFile(
    join(testDir, "skill-a", "SKILL.md"),
    [
      "---",
      'name: "skill-a"',
      'description: "A test skill"',
      "tier: 1",
      'tools_required: [bash]',
      'tags: [test]',
      "---",
      "# Skill A",
      "Content here.",
    ].join("\n"),
    "utf8"
  );

  await mkdir(join(testDir, "skill-b"), { recursive: true });
  await writeFile(
    join(testDir, "skill-b", "SKILL.md"),
    [
      "---",
      'name: "skill-b"',
      'description: "Another skill"',
      "tier: 2",
      'tools_required: [file_read, file_edit]',
      'tags: [test, another]',
      "---",
      "# Skill B",
      "More content.",
    ].join("\n"),
    "utf8"
  );
});

after(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("SkillLoader", () => {
  it("discovers available skills", async () => {
    const loader = new SkillLoader(testDir);
    const skills = await loader.list();
    assert.equal(skills.length, 2);
    const names = skills.map((s) => s.name);
    assert.ok(names.includes("skill-a"));
    assert.ok(names.includes("skill-b"));
  });

  it("loads skill metadata and content", async () => {
    const loader = new SkillLoader(testDir);
    const skill = await loader.load("skill-a");
    assert.ok(skill !== null);
    assert.equal(skill!.meta.name, "skill-a");
    assert.equal(skill!.meta.description, "A test skill");
    assert.equal(skill!.meta.tier, 1);
    assert.deepEqual(skill!.meta.toolsRequired, ["bash"]);
    assert.deepEqual(skill!.meta.tags, ["test"]);
    assert.ok(skill!.content.includes("Skill A"));
  });

  it("returns null for unknown skill", async () => {
    const loader = new SkillLoader(testDir);
    const skill = await loader.load("nonexistent");
    assert.equal(skill, null);
  });

  it("returns empty list when directory is missing", async () => {
    const loader = new SkillLoader(join(testDir, "does-not-exist"));
    const skills = await loader.list();
    assert.equal(skills.length, 0);
  });
});
