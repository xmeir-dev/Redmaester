import { TriageStatus } from "@prisma/client";

import { getXConnectionStatus } from "@/lib/auth/token-store";
import { prisma } from "@/lib/db/prisma";
import { getCurrentMonthSpend } from "@/lib/domain/budget";
import { appConfig } from "@/lib/domain/config";

export async function getDashboardData() {
  const [
    bookmarkCount,
    classificationCount,
    skillCount,
    referenceCount,
    pendingClassificationCount,
    openTriageCount,
    monthSpend,
    xConnection
  ] = await Promise.all([
    prisma.bookmark.count(),
    prisma.bookmarkClassification.count(),
    prisma.skill.count(),
    prisma.skillReference.count(),
    prisma.bookmark.count({
      where: { classifications: null }
    }),
    prisma.triageQueue.count({ where: { status: TriageStatus.OPEN } }),
    getCurrentMonthSpend(),
    getXConnectionStatus()
  ]);

  return {
    metrics: {
      bookmarkCount,
      classificationCount,
      skillCount,
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
        matchedSkill: {
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
  return prisma.bookmark.findMany({
    orderBy: { bookmarkedAt: "desc" },
    include: {
      classifications: {
        select: {
          classificationType: true,
          action: true,
          confidence: true,
          rationale: true,
          extractedSkillName: true,
          fallback: true,
          classifiedAt: true,
          matchedSkill: {
            select: { name: true }
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
}

export async function getSkillsData() {
  const skills = await prisma.skill.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { references: true }
      }
    }
  });

  return {
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      source: s.source,
      content: s.content,
      referenceCount: s._count.references,
      createdAt: s.createdAt
    }))
  };
}
