import { SkillKind, type Skill } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  source: string;
  referenceCount: number;
  createdAt: Date;
};

function summarizeContent(content: string): string {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#"));
  return lines[0]?.slice(0, 200) ?? "No description available";
}

export async function listSkills(): Promise<SkillSummary[]> {
  const skills = await prisma.skill.findMany({
    include: { _count: { select: { references: true } } },
    orderBy: { createdAt: "desc" }
  });

  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    source: s.source,
    referenceCount: s._count.references,
    createdAt: s.createdAt
  }));
}

export async function getSkillByName(name: string): Promise<Skill | null> {
  return prisma.skill.findUnique({ where: { name } });
}

export async function createSkill(data: {
  name: string;
  content: string;
  source?: string;
  sourceBookmarkId?: string;
  kind?: SkillKind;
  bucketId?: string;
  parentSkillId?: string;
}): Promise<Skill> {
  return prisma.skill.create({
    data: {
      name: data.name,
      content: data.content,
      description: summarizeContent(data.content),
      source: data.source ?? "user",
      kind: data.kind ?? SkillKind.MICRO,
      bucketId: data.bucketId,
      parentSkillId: data.parentSkillId,
      sourceBookmarkId: data.sourceBookmarkId
    }
  });
}
