import { prisma } from "@/lib/db/prisma";
import { queueTriage } from "@/lib/triage/service";
import {
  ensureKnowledgeInstructions,
  hashContent,
  scanSkillsDirectory,
  writeKnowledgeFile,
  writeSkillMd
} from "@/lib/openclaw/filesystem";

function summarizeSkill(skillName: string, skillBody: string): string {
  const lines = skillBody
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));
  return lines[0]?.slice(0, 200) ?? `Skill: ${skillName}`;
}

export async function importSkillsFromFilesystem(workspace: string): Promise<{
  imported: number;
  updated: number;
  conflicted: number;
}> {
  const fsSkills = await scanSkillsDirectory(workspace);
  let imported = 0;
  let updated = 0;
  let conflicted = 0;

  for (const fsSkill of fsSkills) {
    const existing = await prisma.skill.findUnique({ where: { name: fsSkill.name } });

    if (!existing) {
      // New skill from filesystem
      await prisma.skill.create({
        data: {
          name: fsSkill.name,
          content: fsSkill.content,
          description: summarizeSkill(fsSkill.name, fsSkill.content),
          source: "openclaw_import",
          fsHash: fsSkill.contentHash,
          fsSyncedAt: new Date()
        }
      });
      imported++;
      continue;
    }

    // Skill exists in DB — three-way merge
    const dbHash = hashContent(existing.content);
    const dbChanged = existing.fsHash ? existing.fsHash !== dbHash : false;
    const fsChanged = existing.fsHash ? existing.fsHash !== fsSkill.contentHash : true;

    if (!fsChanged && !dbChanged) {
      // No changes
      continue;
    }

    if (fsChanged && !dbChanged) {
      // FS changed only → FS wins
      await prisma.skill.update({
        where: { id: existing.id },
        data: {
          content: fsSkill.content,
          description: summarizeSkill(fsSkill.name, fsSkill.content),
          fsHash: fsSkill.contentHash,
          fsSyncedAt: new Date()
        }
      });
      updated++;
    } else if (!fsChanged && dbChanged) {
      // DB changed only → already correct, update fsHash
      await prisma.skill.update({
        where: { id: existing.id },
        data: { fsHash: dbHash, fsSyncedAt: new Date() }
      });
    } else {
      // Both changed → DB wins + queue triage
      await prisma.skill.update({
        where: { id: existing.id },
        data: { fsHash: dbHash, fsSyncedAt: new Date() }
      });
      // Find a bookmark to attach the triage to (use sourceBookmarkId or first reference)
      const bookmarkId = existing.sourceBookmarkId;
      if (bookmarkId) {
        await queueTriage(
          bookmarkId,
          "merge_conflict",
          `Skill "${fsSkill.name}" was modified both in DB and on filesystem. DB version kept.`
        );
      }
      conflicted++;
    }
  }

  return { imported, updated, conflicted };
}

export async function exportSkillsToFilesystem(workspace: string): Promise<{
  exported: number;
}> {
  const dbSkills = await prisma.skill.findMany();
  let exported = 0;

  for (const skill of dbSkills) {
    const dbHash = hashContent(skill.content);
    if (skill.fsHash === dbHash) {
      continue; // Already in sync
    }

    await writeSkillMd(workspace, skill.name, skill.content);
    await prisma.skill.update({
      where: { id: skill.id },
      data: { fsHash: dbHash, fsSyncedAt: new Date() }
    });
    exported++;
  }

  return { exported };
}

export async function syncSkillsBidirectional(workspace: string): Promise<{
  imported: number;
  updated: number;
  exported: number;
  conflicted: number;
}> {
  const importResult = await importSkillsFromFilesystem(workspace);
  const exportResult = await exportSkillsToFilesystem(workspace);

  return {
    imported: importResult.imported,
    updated: importResult.updated,
    exported: exportResult.exported,
    conflicted: importResult.conflicted
  };
}

export async function deliverKnowledge(
  workspace: string,
  skillName: string,
  tweetId: string,
  markdown: string
): Promise<void> {
  await ensureKnowledgeInstructions(workspace, skillName);
  await writeKnowledgeFile(workspace, skillName, tweetId, markdown);
}
