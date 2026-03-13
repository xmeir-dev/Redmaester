import { SkillKind, type Bucket, type Skill } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export function toKebabCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "general";
}

export function toDisplayName(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function summarizeSkillContent(content: string): string {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));

  return lines[0]?.slice(0, 200) ?? "No description available";
}

function masterSkillPlaceholder(bucket: Pick<Bucket, "displayName" | "name" | "description">): string {
  return [
    `# ${bucket.displayName}`,
    "",
    `You are the master skill for the ${bucket.displayName} bucket.`,
    "",
    "## Current Focus",
    bucket.description || `Capture the recurring knowledge, strategies, and mental models about ${bucket.displayName}.`,
    "",
    "## Status",
    "This master skill has been scaffolded and is waiting for synthesized updates from new bookmarks.",
  ].join("\n");
}

export async function ensureBucket(input: {
  name: string;
  displayName?: string;
  description?: string;
}): Promise<Bucket> {
  const name = toKebabCase(input.name);
  const displayName = input.displayName?.trim() || toDisplayName(name);
  const description = input.description?.trim() || `Knowledge bucket for ${displayName}.`;

  return prisma.bucket.upsert({
    where: { name },
    update: {
      displayName,
      description,
    },
    create: {
      name,
      displayName,
      description,
      dirtySince: null,
    },
  });
}

export async function ensureMasterSkill(bucket: Bucket): Promise<Skill> {
  const existing = await prisma.skill.findFirst({
    where: {
      bucketId: bucket.id,
      kind: SkillKind.MASTER,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.skill.create({
    data: {
      name: bucket.name,
      content: masterSkillPlaceholder(bucket),
      description: bucket.description,
      source: "bucket",
      kind: SkillKind.MASTER,
      bucketId: bucket.id,
    },
  });
}

export async function assignPrimaryBucket(bookmarkId: string, bucketId: string): Promise<void> {
  await prisma.bookmarkBucketAssignment.deleteMany({
    where: {
      bookmarkId,
      isPrimary: true,
      NOT: { bucketId },
    },
  });

  await prisma.bookmarkBucketAssignment.upsert({
    where: {
      bookmarkId_bucketId: {
        bookmarkId,
        bucketId,
      },
    },
    update: {
      isPrimary: true,
    },
    create: {
      bookmarkId,
      bucketId,
      isPrimary: true,
    },
  });
}

export async function markBucketDirty(bucketId: string): Promise<void> {
  await prisma.bucket.update({
    where: { id: bucketId },
    data: { dirtySince: new Date() },
  });
}

export async function uniqueMicroSkillName(baseName: string, bucketName: string): Promise<string> {
  const normalizedBase = toKebabCase(baseName);
  const rooted = normalizedBase.startsWith(`${bucketName}-`)
    ? normalizedBase
    : `${bucketName}-${normalizedBase}`;

  const existing = await prisma.skill.findUnique({ where: { name: rooted } });
  if (!existing) {
    return rooted;
  }

  for (let i = 2; i <= 20; i++) {
    const candidate = `${rooted}-${i}`;
    const collision = await prisma.skill.findUnique({ where: { name: candidate } });
    if (!collision) {
      return candidate;
    }
  }

  return `${rooted}-${Date.now()}`;
}
