import type { Bookmark, BookmarkEnrichment } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { appConfig } from "@/lib/domain/config";
import type { ClassificationOutput } from "@/lib/classification/classifier";
import { queueTriage } from "@/lib/triage/service";

export type ActionResult = {
  action: string;
  skillCreated: boolean;
  referenceAttached: boolean;
  triaged: boolean;
  classificationId: string;
};

function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function uniqueSkillName(baseName: string): Promise<string> {
  const kebab = toKebabCase(baseName);
  const existing = await prisma.skill.findUnique({ where: { name: kebab } });
  if (!existing) return kebab;
  // Append suffix on collision
  for (let i = 2; i <= 10; i++) {
    const candidate = `${kebab}-${i}`;
    const found = await prisma.skill.findUnique({ where: { name: candidate } });
    if (!found) return candidate;
  }
  return `${kebab}-${Date.now()}`;
}

function summarizeSkillContent(content: string): string {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#"));
  return lines[0]?.slice(0, 200) ?? "Skill created from bookmark classification";
}

export async function handleClassification(
  bookmark: Bookmark,
  classification: ClassificationOutput,
  _enrichments: BookmarkEnrichment[],
  runId: string | null
): Promise<ActionResult> {
  const { type, confidence, rationale, skillName, matchedSkillId, extractedSkillContent, fallback } =
    classification;

  let action: string;
  let skillCreated = false;
  let referenceAttached = false;
  let triaged = false;
  let createdSkillId: string | undefined;

  if (type === "skill") {
    if (confidence >= appConfig.classificationAutoCreateThreshold && extractedSkillContent) {
      // Auto-create skill
      const name = await uniqueSkillName(skillName ?? "unnamed-skill");
      const skill = await prisma.skill.create({
        data: {
          name,
          content: extractedSkillContent,
          description: summarizeSkillContent(extractedSkillContent),
          source: "bookmark",
          sourceBookmarkId: bookmark.id
        }
      });
      createdSkillId = skill.id;
      action = "auto_created";
      skillCreated = true;
    } else if (confidence >= appConfig.classificationReviewThreshold) {
      // Stage for review
      await queueTriage(
        bookmark.id,
        "skill_review",
        `Potential skill "${skillName ?? "unknown"}" (confidence: ${confidence.toFixed(2)})`
      );
      action = "staged_for_review";
      triaged = true;
    } else {
      action = "no_action";
    }
  } else if (type === "reference" && matchedSkillId) {
    if (matchedSkillId.startsWith("__seed__")) {
      // Seed skill reference — route to triage instead of creating a SkillReference
      // to a non-existent skill
      await queueTriage(
        bookmark.id,
        "reference_review",
        `Reference to seed skill "${classification.matchedSkillName ?? matchedSkillId}" (confidence: ${confidence.toFixed(2)}) — needs real skill to attach to`
      );
      action = "staged_for_review";
      triaged = true;
    } else if (confidence >= appConfig.classificationReferenceThreshold) {
      // Attach reference to real skill
      await prisma.skillReference.upsert({
        where: {
          skillId_bookmarkId: { skillId: matchedSkillId, bookmarkId: bookmark.id }
        },
        create: {
          skillId: matchedSkillId,
          bookmarkId: bookmark.id,
          rationale
        },
        update: { rationale }
      });
      action = "attached_reference";
      referenceAttached = true;
    } else {
      action = "no_action";
    }
  } else {
    action = "no_action";
  }

  // Create classification record
  const classificationRecord = await prisma.bookmarkClassification.create({
    data: {
      bookmarkId: bookmark.id,
      classificationType: type,
      action,
      confidence,
      rationale,
      extractedSkillName: skillName,
      extractedSkillContent,
      matchedSkillId: createdSkillId ?? (matchedSkillId?.startsWith("__seed__") ? null : matchedSkillId),
      fallback,
      sourceRunId: runId
    }
  });

  return {
    action,
    skillCreated,
    referenceAttached,
    triaged,
    classificationId: classificationRecord.id
  };
}
