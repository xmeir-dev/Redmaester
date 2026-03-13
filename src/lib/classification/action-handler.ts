import { BookmarkRoleType, SkillKind, type Bookmark, type Bucket, type Skill } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { assignPrimaryBucket, ensureMasterSkill, markBucketDirty, summarizeSkillContent, uniqueMicroSkillName } from "@/lib/buckets/service";
import type { BucketedClassificationOutput } from "@/lib/classification/classifier";
import { queueTriage } from "@/lib/triage/service";

export type ActionResult = {
  action: string;
  skillCreated: boolean;
  referenceAttached: boolean;
  triaged: boolean;
  classificationId: string;
  targetSkillId?: string;
  targetSkillName?: string;
};

export async function handleClassification(input: {
  bookmark: Bookmark;
  bucket: Bucket;
  classification: BucketedClassificationOutput;
  runId: string | null;
  microSkillContent?: string | null;
  targetSkill?: Pick<Skill, "id" | "name" | "kind"> | null;
  reviewReason?: string;
  existingClassificationId?: string | null;
  deferMicroSkillGeneration?: boolean;
}): Promise<ActionResult> {
  const {
    bookmark,
    bucket,
    classification,
    runId,
    microSkillContent,
    targetSkill,
    reviewReason,
    existingClassificationId,
    deferMicroSkillGeneration,
  } = input;

  await assignPrimaryBucket(bookmark.id, bucket.id);
  const masterSkill = await ensureMasterSkill(bucket);

  let action = "no_action";
  let skillCreated = false;
  let referenceAttached = false;
  let triaged = false;
  let finalTargetSkillId: string | undefined;
  let finalTargetSkillName: string | undefined;
  let extractedSkillName: string | undefined;
  let extractedSkillContent: string | undefined;

  if (classification.roleType === "REFERENCE") {
    const referenceTarget = targetSkill ?? masterSkill;
    await prisma.skillReference.upsert({
      where: {
        skillId_bookmarkId: {
          skillId: referenceTarget.id,
          bookmarkId: bookmark.id,
        },
      },
      update: {
        rationale: classification.rationale,
      },
      create: {
        skillId: referenceTarget.id,
        bookmarkId: bookmark.id,
        rationale: classification.rationale,
      },
    });
    action = "attached_reference";
    referenceAttached = true;
    finalTargetSkillId = referenceTarget.id;
    finalTargetSkillName = referenceTarget.name;
    await markBucketDirty(bucket.id);
  }

  if (classification.roleType === "MICRO_SKILL") {
    const resolvedName = classification.microSkillName ?? `${bucket.name}-micro-skill`;
    extractedSkillName = resolvedName;
    extractedSkillContent = microSkillContent ?? undefined;

    if (deferMicroSkillGeneration && !microSkillContent) {
      action = "queued_micro_skill";
      finalTargetSkillName = resolvedName;
    } else if (targetSkill && microSkillContent) {
      await prisma.skill.update({
        where: { id: targetSkill.id },
        data: {
          content: microSkillContent,
          description: summarizeSkillContent(microSkillContent),
        },
      });
      action = "updated_micro_skill";
      finalTargetSkillId = targetSkill.id;
      finalTargetSkillName = targetSkill.name;
    } else if (microSkillContent) {
      const finalName = await uniqueMicroSkillName(resolvedName, bucket.name);
      const createdSkill = await prisma.skill.create({
        data: {
          name: finalName,
          content: microSkillContent,
          description: summarizeSkillContent(microSkillContent),
          source: "bookmark",
          kind: SkillKind.MICRO,
          bucketId: bucket.id,
          parentSkillId: masterSkill.id,
          sourceBookmarkId: bookmark.id,
        },
      });
      action = "created_micro_skill";
      skillCreated = true;
      finalTargetSkillId = createdSkill.id;
      finalTargetSkillName = createdSkill.name;
      extractedSkillName = createdSkill.name;
    } else {
      await prisma.skillReference.upsert({
        where: {
          skillId_bookmarkId: {
            skillId: masterSkill.id,
            bookmarkId: bookmark.id,
          },
        },
        update: {
          rationale: `${classification.rationale} [fallback: micro-skill generation failed]`,
        },
        create: {
          skillId: masterSkill.id,
          bookmarkId: bookmark.id,
          rationale: `${classification.rationale} [fallback: micro-skill generation failed]`,
        },
      });
      action = "attached_reference";
      referenceAttached = true;
      finalTargetSkillId = masterSkill.id;
      finalTargetSkillName = masterSkill.name;
    }

    await markBucketDirty(bucket.id);
  }

  const classificationData = {
    bookmarkId: bookmark.id,
    classificationType: classification.roleType.toLowerCase(),
    action,
    bucketId: bucket.id,
    roleType: classification.roleType as BookmarkRoleType,
    targetSkillId: finalTargetSkillId,
    confidence: classification.confidence,
    rationale: classification.rationale,
    extractedSkillName,
    extractedSkillContent,
    fallback: classification.fallback,
    sourceRunId: runId,
    classifiedAt: new Date(),
  };

  const classificationRecord = existingClassificationId
    ? await prisma.bookmarkClassification.update({
        where: { id: existingClassificationId },
        data: classificationData,
      })
    : await prisma.bookmarkClassification.create({
        data: classificationData,
      });

  if (reviewReason) {
    await queueTriage(bookmark.id, "micro_skill_review", reviewReason);
    triaged = true;
  }

  return {
    action,
    skillCreated,
    referenceAttached,
    triaged,
    classificationId: classificationRecord.id,
    targetSkillId: finalTargetSkillId,
    targetSkillName: finalTargetSkillName,
  };
}
