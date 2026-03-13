import { BookmarkRoleType, SkillKind, TriageStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export async function queueTriage(tweetId: string, reason: string, details?: string): Promise<void> {
  const existing = await prisma.triageQueue.findFirst({
    where: {
      tweetId,
      status: TriageStatus.OPEN
    }
  });

  if (existing) {
    await prisma.triageQueue.update({
      where: { id: existing.id },
      data: { reason, details }
    });
    return;
  }

  await prisma.triageQueue.create({
    data: {
      tweetId,
      reason,
      details
    }
  });
}

export async function resolveTriage(id: string, skillName: string): Promise<void> {
  await prisma.triageQueue.update({
    where: { id },
    data: {
      status: TriageStatus.RESOLVED,
      assignedSkillName: skillName,
      resolvedAt: new Date()
    }
  });
}

export async function resolveSkillReview(
  id: string,
  approved: boolean,
  editedName?: string,
  editedContent?: string
): Promise<{ action: string }> {
  if (!approved) {
    await prisma.triageQueue.update({
      where: { id },
      data: {
        status: TriageStatus.RESOLVED,
        assignedSkillName: "rejected",
        resolvedAt: new Date()
      }
    });
    return { action: "rejected" };
  }

  const triageItem = await prisma.triageQueue.findUnique({ where: { id } });
  if (!triageItem) {
    throw new Error("Triage item not found");
  }

  const classification = await prisma.bookmarkClassification.findUnique({
    where: { bookmarkId: triageItem.tweetId }
  });

  const skillName = editedName ?? classification?.extractedSkillName ?? "unnamed-skill";
  const skillContent = editedContent ?? classification?.extractedSkillContent;

  if (!skillContent) {
    throw new Error("No skill content available");
  }

  const kebabName = skillName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const lines = skillContent
    .split("\n")
    .map((l: string) => l.trim())
    .filter(Boolean)
    .filter((l: string) => !l.startsWith("#"));
  const description = lines[0]?.slice(0, 200) ?? `Skill: ${kebabName}`;

  const masterSkill = classification?.bucketId
    ? await prisma.skill.findFirst({
        where: {
          bucketId: classification.bucketId,
          kind: SkillKind.MASTER
        },
        select: { id: true }
      })
    : null;

  const skill = await prisma.skill.create({
    data: {
      name: kebabName,
      content: skillContent,
      description,
      source: "bookmark",
      kind: SkillKind.MICRO,
      bucketId: classification?.bucketId ?? null,
      parentSkillId: masterSkill?.id,
      sourceBookmarkId: triageItem.tweetId
    }
  });

  if (classification) {
    await prisma.bookmarkClassification.update({
      where: { id: classification.id },
      data: {
        action: "user_approved",
        classificationType: "micro_skill",
        roleType: BookmarkRoleType.MICRO_SKILL,
        targetSkillId: skill.id
      }
    });
  }

  await prisma.triageQueue.update({
    where: { id },
    data: {
      status: TriageStatus.RESOLVED,
      assignedSkillName: kebabName,
      resolvedAt: new Date()
    }
  });

  return { action: "approved" };
}
