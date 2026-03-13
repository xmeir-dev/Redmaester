import { SkillKind, TriageStatus } from "@prisma/client";

import { buildHeuristicBucketSuggestions } from "@/lib/buckets/curation";
import { getXConnectionStatus } from "@/lib/auth/token-store";
import { prisma } from "@/lib/db/prisma";
import { getCurrentMonthSpend } from "@/lib/domain/budget";
import { appConfig } from "@/lib/domain/config";
import {
  getBucketAudienceMap,
  type BucketAudience,
  getBucketOnboardingState,
  getBucketTierMap,
  type BucketTier,
} from "@/lib/settings/service";

function pendingClassificationWhere(agentBucketIds: string[]) {
  if (agentBucketIds.length === 0) {
    return { id: { in: [] as string[] } };
  }

  return {
    AND: [
      {
        bucketAssignments: {
          some: {
            isPrimary: true,
            bucketId: { in: agentBucketIds },
          },
        },
      },
      {
        OR: [
          { classifications: null },
          { classifications: { is: { bucketId: null } } },
          { classifications: { is: { roleType: null } } },
          { classifications: { is: { fallback: true } } },
        ],
      },
    ],
  };
}

export async function getDashboardData() {
  const buckets = await prisma.bucket.findMany({
    select: { id: true },
  });
  const bucketTierMap = await getBucketTierMap(buckets.map((bucket) => bucket.id));
  const bucketAudienceMap = await getBucketAudienceMap(
    buckets.map((bucket) => bucket.id),
  );
  const agentBucketIds = buckets
    .filter(
      (bucket) =>
        bucketTierMap[bucket.id] === "REAL" &&
        bucketAudienceMap[bucket.id] === "AGENT",
    )
    .map((bucket) => bucket.id);
  const realAgentBucketCount = agentBucketIds.length;
  const undecidedBucketCount = buckets.filter(
    (bucket) =>
      bucketTierMap[bucket.id] === "REAL" &&
      bucketAudienceMap[bucket.id] === "UNDECIDED",
  ).length;
  const realBucketCount = buckets.filter(
    (bucket) => bucketTierMap[bucket.id] === "REAL",
  ).length;
  const suggestedBucketCount = buckets.length - realBucketCount;

  const [
    bookmarkCount,
    classificationCount,
    skillCount,
    microSkillCount,
    masterSkillCount,
    referenceCount,
    pendingClassificationCount,
    openTriageCount,
    monthSpend,
    xConnection,
    onboardingState,
  ] = await Promise.all([
    prisma.bookmark.count(),
    prisma.bookmarkClassification.count(),
    prisma.skill.count(),
    prisma.skill.count({ where: { kind: SkillKind.MICRO } }),
    prisma.skill.count({ where: { kind: SkillKind.MASTER } }),
    prisma.skillReference.count(),
    prisma.bookmark.count({ where: pendingClassificationWhere(agentBucketIds) }),
    prisma.triageQueue.count({ where: { status: TriageStatus.OPEN } }),
    getCurrentMonthSpend(),
    getXConnectionStatus(),
    getBucketOnboardingState(),
  ]);

  return {
    metrics: {
      bookmarkCount,
      bucketCount: buckets.length,
      realBucketCount,
      realAgentBucketCount,
      suggestedBucketCount,
      undecidedBucketCount,
      needsBucketOnboarding:
        buckets.length > 0 &&
        realAgentBucketCount === 0 &&
        onboardingState.completedAt === null,
      onboardingCompletedAt: onboardingState.completedAt,
      classificationCount,
      skillCount,
      microSkillCount,
      masterSkillCount,
      referenceCount,
      pendingClassificationCount,
      openTriageCount,
      budgetRemaining: Math.max(0, appConfig.monthlyBudgetUsd - monthSpend),
      monthSpend
    },
    xConnection
  };
}

export async function getLogsData() {
  const [recentRuns, recentClassifications] = await Promise.all([
    prisma.syncRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 50
    }),
    prisma.bookmarkClassification.findMany({
      orderBy: { classifiedAt: "desc" },
      take: 80,
      include: {
        bookmark: {
          select: {
            text: true,
            authorHandle: true,
            url: true
          }
        },
        bucket: {
          select: {
            name: true
          }
        },
        targetSkill: {
          select: {
            name: true
          }
        }
      }
    })
  ]);

  return {
    recentRuns,
    recentClassifications
  };
}

export async function getTriageData() {
  return prisma.triageQueue.findMany({
    where: { status: TriageStatus.OPEN },
    orderBy: { createdAt: "desc" },
    include: {
      bookmark: {
        select: {
          text: true,
          authorHandle: true,
          url: true
        }
      }
    }
  });
}

export async function getBookmarksData() {
  const bookmarks = await prisma.bookmark.findMany({
    orderBy: { bookmarkedAt: "desc" },
    include: {
      classifications: {
        select: {
          classificationType: true,
          action: true,
          roleType: true,
          confidence: true,
          rationale: true,
          extractedSkillName: true,
          fallback: true,
          classifiedAt: true,
          bucket: {
            select: { name: true, displayName: true }
          },
          targetSkill: {
            select: { name: true }
          }
        }
      },
      bucketAssignments: {
        where: { isPrimary: true },
        select: {
          bucket: {
            select: {
              id: true,
              name: true,
              displayName: true
            }
          }
        }
      },
      triageItems: {
        where: { status: TriageStatus.OPEN },
        select: {
          id: true,
          reason: true,
          details: true
        }
      },
      enrichments: {
        select: {
          url: true,
          title: true,
          contentLength: true,
          fetchMethod: true,
          fetchError: true
        }
      },
    }
  });

  const bucketIds = Array.from(
    new Set(
      bookmarks.flatMap((bookmark) =>
        bookmark.bucketAssignments.map((assignment) => assignment.bucket.id),
      ),
    ),
  );
  const audienceMap = await getBucketAudienceMap(bucketIds);
  const tierMap = await getBucketTierMap(bucketIds);

  return bookmarks.map((bookmark) => ({
    ...bookmark,
    bucketAssignments: bookmark.bucketAssignments.map((assignment) => ({
      ...assignment,
      bucket: {
        ...assignment.bucket,
        audience: audienceMap[assignment.bucket.id] ?? "UNDECIDED",
        tier: tierMap[assignment.bucket.id] ?? "SUGGESTED",
      },
    })),
  }));
}

export async function getSkillsData() {
  const skills = await prisma.skill.findMany({
    orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
    include: {
      bucket: {
        select: {
          name: true,
          displayName: true
        }
      },
      _count: {
        select: { references: true }
      }
    }
  });

  return {
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      description: s.description,
      source: s.source,
      bucketName: s.bucket?.displayName ?? null,
      content: s.content,
      referenceCount: s._count.references,
      createdAt: s.createdAt
    }))
  };
}

export async function getBucketsData() {
  const buckets = await prisma.bucket.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: {
          bookmarkAssignments: true,
        }
      },
      bookmarkAssignments: {
        take: 12,
        orderBy: {
          createdAt: "desc",
        },
        select: {
          bookmark: {
            select: {
              id: true,
              text: true,
              authorHandle: true,
              url: true,
              bookmarkedAt: true,
            },
          },
        },
      },
      skills: {
        orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
        include: {
          _count: {
            select: {
              references: true
            }
          }
        }
      }
    }
  });
  const audienceMap = await getBucketAudienceMap(buckets.map((bucket) => bucket.id));
  const tierMap = await getBucketTierMap(buckets.map((bucket) => bucket.id));
  const onboarding = await getBucketOnboardingState();
  const undecidedBucketCount = buckets.filter(
    (bucket) =>
      (tierMap[bucket.id] ?? "SUGGESTED") === "REAL" &&
      (audienceMap[bucket.id] ?? "UNDECIDED") === "UNDECIDED",
  ).length;
  const realBucketCount = buckets.filter(
    (bucket) => (tierMap[bucket.id] ?? "SUGGESTED") === "REAL",
  ).length;
  const realAgentBucketCount = buckets.filter(
    (bucket) =>
      (tierMap[bucket.id] ?? "SUGGESTED") === "REAL" &&
      (audienceMap[bucket.id] ?? "UNDECIDED") === "AGENT",
  ).length;
  const suggestedBucketCount = buckets.length - realBucketCount;

  const bucketRows = buckets.map((bucket) => {
    const masterSkill = bucket.skills.find((skill) => skill.kind === SkillKind.MASTER) ?? null;
    const microSkills = bucket.skills.filter((skill) => skill.kind === SkillKind.MICRO);

      return {
        id: bucket.id,
        name: bucket.name,
        displayName: bucket.displayName,
        description: bucket.description,
      tier: (tierMap[bucket.id] ?? "SUGGESTED") as BucketTier,
      audience: (audienceMap[bucket.id] ?? "UNDECIDED") as BucketAudience,
      bookmarkCount: bucket._count.bookmarkAssignments,
      dirtySince: bucket.dirtySince,
      lastMasterSynthesizedAt: bucket.lastMasterSynthesizedAt,
      masterSkill: masterSkill
        ? {
            id: masterSkill.id,
            name: masterSkill.name,
            description: masterSkill.description,
            updatedAt: masterSkill.updatedAt,
          }
        : null,
        microSkills: microSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          referenceCount: skill._count.references,
          updatedAt: skill.updatedAt,
        })),
        bookmarks: bucket.bookmarkAssignments.map((assignment) => ({
          id: assignment.bookmark.id,
          text: assignment.bookmark.text,
          authorHandle: assignment.bookmark.authorHandle,
          url: assignment.bookmark.url,
          bookmarkedAt: assignment.bookmark.bookmarkedAt,
        })),
      };
    });

  return {
    undecidedBucketCount,
    realBucketCount,
    realAgentBucketCount,
    suggestedBucketCount,
    onboarding: {
      ...onboarding,
      needsOnboarding:
        buckets.length > 0 &&
        realAgentBucketCount === 0 &&
        onboarding.completedAt === null,
    },
    suggestions: buildHeuristicBucketSuggestions(
      bucketRows.map((bucket) => ({
        id: bucket.id,
        displayName: bucket.displayName,
        description: bucket.description,
        tier: bucket.tier,
        audience: bucket.audience,
        bookmarkCount: bucket.bookmarkCount,
        microSkillCount: bucket.microSkills.length,
      })),
    ),
    buckets: bucketRows,
  };
}
