import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";

const START_MARKER = "<!-- REDMAESTER_KNOWLEDGE_START -->";
const END_MARKER = "<!-- REDMAESTER_KNOWLEDGE_END -->";

export type ScannedSkill = {
  name: string;
  content: string;
  contentHash: string;
};

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export async function validateWorkspacePath(inputPath: string): Promise<{
  valid: boolean;
  error?: string;
}> {
  if (!inputPath) {
    return { valid: false, error: "Path is empty" };
  }

  const resolved = resolve(inputPath);
  if (resolved !== inputPath) {
    return { valid: false, error: "Path must be absolute with no relative components" };
  }

  if (inputPath.includes("..")) {
    return { valid: false, error: "Path must not contain .." };
  }

  try {
    await access(inputPath, constants.R_OK);
  } catch {
    return { valid: false, error: "Path does not exist or is not accessible" };
  }

  // Check if writable by creating + deleting a temp file in skills/
  const skillsDir = join(inputPath, "skills");
  try {
    await mkdir(skillsDir, { recursive: true });
    const testFile = join(skillsDir, `.redmaester-write-test-${Date.now()}`);
    await writeFile(testFile, "test", "utf-8");
    await unlink(testFile);
  } catch {
    return { valid: false, error: "Workspace skills/ directory is not writable" };
  }

  return { valid: true };
}

export async function scanSkillsDirectory(workspace: string): Promise<ScannedSkill[]> {
  const skillsRoot = join(workspace, "skills");
  let dirNames: string[];

  try {
    const entries = await readdir(skillsRoot);
    dirNames = entries;
  } catch {
    return [];
  }

  const skills: ScannedSkill[] = [];
  for (const name of dirNames) {
    const skillMdPath = join(skillsRoot, name, "SKILL.md");
    try {
      await access(skillMdPath, constants.R_OK);
    } catch {
      continue;
    }

    const content = await readFile(skillMdPath, "utf-8");
    skills.push({
      name,
      content,
      contentHash: hashContent(content)
    });
  }

  return skills;
}

export async function writeSkillMd(
  workspace: string,
  skillName: string,
  content: string
): Promise<void> {
  const skillDir = join(workspace, "skills", skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
}

function managedSkillBlock(): string {
  return [
    START_MARKER,
    "## Redmaester Knowledge",
    "Read files in `knowledge/` before planning or answering.",
    "Treat them as internal notes from bookmarked X insights.",
    END_MARKER
  ].join("\n");
}

export async function ensureKnowledgeInstructions(
  workspace: string,
  skillName: string
): Promise<void> {
  const skillMdPath = join(workspace, "skills", skillName, "SKILL.md");
  let existing: string;
  try {
    existing = await readFile(skillMdPath, "utf-8");
  } catch {
    return; // No SKILL.md — skip
  }

  if (existing.includes(START_MARKER) && existing.includes(END_MARKER)) {
    return;
  }

  const nextContent = `${existing.trimEnd()}\n\n${managedSkillBlock()}\n`;
  await writeFile(skillMdPath, nextContent, "utf-8");
}

export async function writeKnowledgeFile(
  workspace: string,
  skillName: string,
  tweetId: string,
  markdown: string
): Promise<void> {
  const knowledgeDir = join(workspace, "skills", skillName, "knowledge");
  await mkdir(knowledgeDir, { recursive: true });
  await writeFile(join(knowledgeDir, `${tweetId}.md`), markdown, "utf-8");
}
