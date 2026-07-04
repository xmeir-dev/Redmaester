// Classification pipeline — the budget-guarded core of Redmaester.
//
// runClassificationPipeline() drives five stages, each capped by the monthly
// budget and a 45s wall clock so it fits inside a serverless invocation:
//   1. Discovery       — assign a primary bucket to bookmarks that lack one
//   2. Enrichment      — fetch content behind linked URLs (fallback chain)
//   3. Classification  — bucket + role (REFERENCE / MICRO_SKILL / IGNORE)
//   4. Micro-skills    — generate queued micro-skills one at a time
//   5. Master skills   — re-synthesize the master doc of "dirty" buckets
// Work left over when time or budget runs out simply stays pending and is
// picked up by the next run (hourly cron or manual trigger).

import {
  BookmarkRoleType,
  Prisma,
  SkillKind,
  type Bookmark,
  type BookmarkEnrichment,
  type Skill,
} from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import {
  assignPrimaryBucket,
  ensureBucket,
  ensureMasterSkill,
  summarizeSkillContent,
} from "@/lib/buckets/service";
import {
  canSpend,
  getCurrentMonthSpend,
  recordUsage,
} from "@/lib/domain/budget";
import { appConfig } from "@/lib/domain/config";
import {
  classifyBookmark,
  generateMicroSkillContent,
  synthesizeMasterSkill,
  type BucketedClassificationOutput,
} from "@/lib/classification/classifier";
import { handleClassification } from "@/lib/classification/action-handler";
import { enrichBookmark } from "@/lib/enrichment/enrichment-service";
import { extractUrls } from "@/lib/enrichment/url-extractor";
import {
  acquireClassificationLock,
  getBucketAudienceMap,
  getBucketTierMap,
  releaseClassificationLock,
  type BucketAudience,
  type BucketTier,
} from "@/lib/settings/service";

export type PipelineResult = {
  discoveredCount: number;
  processed: number;
  enriched: number;
  classified: number;
  skillsCreated: number;
  referencesAttached: number;
  triaged: number;
  bucketsRefreshed: number;
  blocked?: boolean;
  needsBucketReview?: boolean;
  discoveryPendingCount?: number;
  pendingCount?: number;
  queuedMicroSkillCount?: number;
  dirtyBucketCount?: number;
  undecidedBucketCount?: number;
  estimatedCost?: number;
  budgetRemaining?: number;
  enrichmentWarning?: string;
  log: string[];
};

type BucketSummary = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  tier: BucketTier;
};

type EnrichmentLoadResult = {
  enrichments: BookmarkEnrichment[];
  totalUrls: number;
  successCount: number;
  failedCount: number;
};

type QueuedMicroSkillResult = {
  enriched: number;
  enrichmentCount: number;
  failedEnrichments: number;
  skillsCreated: number;
  referencesAttached: number;
  triaged: number;
};

const BOOKMARK_BATCH_SIZE = 10;
const MICRO_SKILL_GENERATION_BATCH_SIZE = 1;
const MASTER_SKILL_REFRESH_BATCH_SIZE = 1;
const MAX_WALL_CLOCK_MS = 45 * 1000;
const MIN_DIRECT_CLASSIFICATION_LENGTH = 100;
const MIN_DIRECT_CLASSIFICATION_WORDS = 12;

// Bookmarks that still need stage 1: no primary bucket assigned yet.
function pendingBucketDiscoveryWhere(): Prisma.BookmarkWhereInput {
  return {
    bucketAssignments: {
      none: {
        isPrimary: true,
      },
    },
  };
}

// Bookmarks that still need stage 3: never classified, missing a bucket or
// role, or only classified by the free keyword fallback (worth an AI retry).
function pendingBookmarkWhere(): Prisma.BookmarkWhereInput {
  return {
    OR: [
      { classifications: { is: null } },
      { classifications: { is: { bucketId: null } } },
      { classifications: { is: { roleType: null } } },
      { classifications: { is: { fallback: true } } },
    ],
  };
}

// Classifications waiting for stage 4: marked MICRO_SKILL but no skill built.
function queuedMicroSkillWhere(): Prisma.BookmarkClassificationWhereInput {
  return {
    roleType: BookmarkRoleType.MICRO_SKILL,
    action: "queued_micro_skill",
    targetSkillId: null,
  };
}

// Same as pendingBookmarkWhere, but limited to buckets whose audience is
// AGENT — only those spend budget on full AI classification.
function agentPendingBookmarkWhere(
  agentBucketIds: string[],
): Prisma.BookmarkWhereInput {
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
      pendingBookmarkWhere(),
    ],
  };
}

function parseRawJson(rawJson: string): unknown {
  try {
    return JSON.parse(rawJson);
  } catch {
    return {};
  }
}

function normalizeTokenSet(value: string): Set<string> {
  return new Set(
    value
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length >= 3),
  );
}

function stripInlineUrls(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bpic\.x\.com\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldEnrichForClassification(bookmark: Bookmark): boolean {
  const strippedText = stripInlineUrls(bookmark.text);
  const words = strippedText.split(/\s+/).filter(Boolean);
  const urls = extractUrls(bookmark.text, parseRawJson(bookmark.rawJson));

  if (urls.length === 0) {
    return false;
  }

  if (strippedText.length === 0) {
    return true;
  }

  if (strippedText.length < MIN_DIRECT_CLASSIFICATION_LENGTH) {
    return true;
  }

  return words.length < MIN_DIRECT_CLASSIFICATION_WORDS;
}

function hasUsableEnrichment(enrichments: BookmarkEnrichment[]): boolean {
  return enrichments.some(
    (enrichment) =>
      enrichment.fetchMethod !== "failed" &&
      (enrichment.contentLength >= 250 || Boolean(enrichment.title)),
  );
}

function bookmarkLabel(bookmark: Pick<Bookmark, "authorHandle" | "text">): string {
  const shortAuthor = `@${bookmark.authorHandle}`;
  const snippet = bookmark.text.slice(0, 60).replace(/\n/g, " ");
  return `${shortAuthor}: "${snippet}${bookmark.text.length > 60 ? "…" : ""}"`;
}

async function loadEnrichmentsForClassification(input: {
  bookmark: Bookmark;
  emit: (message: string) => void;
}): Promise<EnrichmentLoadResult> {
  const existing = await prisma.bookmarkEnrichment.findMany({
    where: { bookmarkId: input.bookmark.id },
    orderBy: { fetchedAt: "desc" },
  });

  if (hasUsableEnrichment(existing) || !shouldEnrichForClassification(input.bookmark)) {
    return {
      enrichments: existing,
      totalUrls: 0,
      successCount: 0,
      failedCount: 0,
    };
  }

  input.emit(`Enriching ${bookmarkLabel(input.bookmark)}`);
  const enrichResult = await enrichBookmark(input.bookmark);
  for (const message of enrichResult.log) {
    input.emit(`  ${message}`);
  }

  return {
    enrichments: enrichResult.enrichments,
    totalUrls: enrichResult.totalUrls,
    successCount: enrichResult.successCount,
    failedCount: enrichResult.totalUrls - enrichResult.successCount,
  };
}

function findMatchingMicroSkill(
  candidateName: string | undefined,
  skills: Pick<Skill, "id" | "name" | "description" | "kind">[],
) {
  if (!candidateName) {
    return null;
  }

  const normalizedCandidate = candidateName.trim().toLowerCase();
  const exact = skills.find((skill) => skill.name === normalizedCandidate);
  if (exact) {
    return exact;
  }

  const candidateTokens = normalizeTokenSet(normalizedCandidate);
  let bestMatch: Pick<Skill, "id" | "name" | "description" | "kind"> | null =
    null;
  let bestScore = 0;

  for (const skill of skills) {
    const score = Array.from(candidateTokens).filter((token) =>
      skill.name.includes(token),
    ).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = skill;
    }
  }

  return bestScore >= 2 ? bestMatch : null;
}

async function refreshDirtyMasterSkills(input: {
  maxBuckets: number;
  force: boolean;
  emit: (message: string) => void;
}): Promise<{ refreshed: number }> {
  const candidateBuckets = await prisma.bucket.findMany({
    where: { dirtySince: { not: null } },
    orderBy: { dirtySince: "asc" },
    take: input.maxBuckets * 4,
  });
  const tierMap = await getBucketTierMap(candidateBuckets.map((bucket) => bucket.id));
  const audienceMap = await getBucketAudienceMap(
    candidateBuckets.map((bucket) => bucket.id),
  );
  const dirtyBuckets = candidateBuckets
    .filter(
      (bucket) =>
        tierMap[bucket.id] === "REAL" && audienceMap[bucket.id] === "AGENT",
    )
    .slice(0, input.maxBuckets);

  let refreshed = 0;

  for (const bucket of dirtyBuckets) {
    const withinBudget =
      input.force || (await canSpend(appConfig.estimatedMasterSkillCostUsd));
    if (!withinBudget) {
      input.emit("Master skill refresh paused — monthly budget reached");
      break;
    }

    const masterSkill = await ensureMasterSkill(bucket);
    const microSkills = await prisma.skill.findMany({
      where: {
        bucketId: bucket.id,
        kind: SkillKind.MICRO,
      },
      select: {
        name: true,
        description: true,
        content: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
    });

    const references = await prisma.skillReference.findMany({
      where: {
        skill: { bucketId: bucket.id },
        ...(bucket.lastMasterSynthesizedAt
          ? { createdAt: { gt: bucket.lastMasterSynthesizedAt } }
          : {}),
      },
      include: {
        bookmark: {
          select: {
            id: true,
            authorHandle: true,
            text: true,
            url: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 16,
    });

    const synthesis = await synthesizeMasterSkill({
      bucket,
      masterSkill,
      microSkills,
      references: references.map((reference) => ({
        tweetId: reference.bookmark.id,
        authorHandle: reference.bookmark.authorHandle,
        text: reference.bookmark.text,
        url: reference.bookmark.url,
        rationale: reference.rationale,
      })),
    });

    if (!synthesis) {
      input.emit(`Master skill refresh skipped for ${bucket.name}`);
      continue;
    }

    if (synthesis.usage) {
      await recordUsage({
        operation: `master-skill:${synthesis.usage.model}`,
        amountUsd: synthesis.usage.costUsd,
      });
    }

    await prisma.$transaction([
      prisma.skill.update({
        where: { id: masterSkill.id },
        data: {
          content: synthesis.content,
          description: summarizeSkillContent(synthesis.content),
        },
      }),
      prisma.bucket.update({
        where: { id: bucket.id },
        data: {
          dirtySince: null,
          lastMasterSynthesizedAt: new Date(),
        },
      }),
    ]);

    input.emit(`Refreshed master skill for ${bucket.displayName}`);
    refreshed += 1;
  }

  return { refreshed };
}

async function countDirtyRealAgentBuckets(): Promise<number> {
  const buckets = await prisma.bucket.findMany({
    where: { dirtySince: { not: null } },
    select: { id: true },
  });
  const tierMap = await getBucketTierMap(buckets.map((bucket) => bucket.id));
  const audienceMap = await getBucketAudienceMap(buckets.map((bucket) => bucket.id));

  return buckets.filter(
    (bucket) =>
      tierMap[bucket.id] === "REAL" && audienceMap[bucket.id] === "AGENT",
  ).length;
}

async function processQueuedMicroSkills(input: {
  maxQueued: number;
  force: boolean;
  emit: (message: string) => void;
  onBookmarkStep?: (bookmarkId: string, step: string) => void;
  startTime: number;
}): Promise<QueuedMicroSkillResult> {
  const queuedClassifications = await prisma.bookmarkClassification.findMany({
    where: queuedMicroSkillWhere(),
    orderBy: { classifiedAt: "asc" },
    take: input.maxQueued,
    include: {
      bookmark: true,
      bucket: true,
    },
  });

  let enriched = 0;
  let enrichmentCount = 0;
  let failedEnrichments = 0;
  let skillsCreated = 0;
  let referencesAttached = 0;
  let triaged = 0;

  for (const queued of queuedClassifications) {
    if (Date.now() - input.startTime >= MAX_WALL_CLOCK_MS) {
      input.emit("Stopping micro-skill generation to stay within runtime limit");
      break;
    }

    const withinBudget =
      input.force || (await canSpend(appConfig.estimatedMicroSkillCostUsd));
    if (!withinBudget) {
      input.emit("Micro-skill generation paused — monthly budget reached");
      break;
    }

    if (!queued.bucket) {
      input.emit(
        `Skipping queued micro-skill for ${bookmarkLabel(queued.bookmark)} because its bucket is missing`,
      );
      continue;
    }

    input.onBookmarkStep?.(queued.bookmarkId, "classifying");

    try {
      const enrichResult = await loadEnrichmentsForClassification({
        bookmark: queued.bookmark,
        emit: input.emit,
      });
      enriched += enrichResult.successCount;
      enrichmentCount += enrichResult.totalUrls;
      failedEnrichments += enrichResult.failedCount;

      const microSkills = await prisma.skill.findMany({
        where: {
          bucketId: queued.bucket.id,
          kind: SkillKind.MICRO,
        },
        select: {
          id: true,
          name: true,
          description: true,
          kind: true,
        },
        orderBy: { updatedAt: "desc" },
      });

      const targetSkill = findMatchingMicroSkill(
        queued.extractedSkillName ?? undefined,
        microSkills,
      );

      input.emit(
        `Generating ${targetSkill ? "existing" : "new"} micro-skill for ${bookmarkLabel(queued.bookmark)}...`,
      );

      const generated = await generateMicroSkillContent({
        bookmark: queued.bookmark,
        enrichments: enrichResult.enrichments,
        bucket: queued.bucket,
        skillName:
          queued.extractedSkillName ?? `${queued.bucket.name}-micro-skill`,
        existingSkill: targetSkill
          ? {
              name: targetSkill.name,
              description: targetSkill.description,
              content:
                (
                  await prisma.skill.findUnique({
                    where: { id: targetSkill.id },
                    select: { content: true },
                  })
                )?.content ?? targetSkill.description,
            }
          : undefined,
      });

      let finalClassification: BucketedClassificationOutput = {
        bucketName: queued.bucket.name,
        bucketDisplayName: queued.bucket.displayName,
        bucketDescription: queued.bucket.description,
        roleType: "MICRO_SKILL",
        confidence: queued.confidence,
        rationale: queued.rationale ?? "Queued for micro-skill generation.",
        microSkillName: queued.extractedSkillName ?? undefined,
        fallback: queued.fallback,
      };

      let microSkillContent: string | null = null;
      let reviewReason: string | undefined;

      if (generated) {
        microSkillContent = generated.content;
        if (generated.usage) {
          await recordUsage({
            operation: `micro-skill:${generated.usage.model}`,
            amountUsd: generated.usage.costUsd,
          });
        }
      } else {
        finalClassification = {
          ...finalClassification,
          roleType: "REFERENCE",
          rationale: `${finalClassification.rationale} Micro-skill generation failed, so this bookmark was attached as a reference instead.`,
        };
        reviewReason = `Micro-skill generation failed for ${queued.extractedSkillName ?? queued.bucket.name}; bookmark attached as a reference for review.`;
      }

      const actionResult = await handleClassification({
        bookmark: queued.bookmark,
        bucket: queued.bucket,
        classification: finalClassification,
        runId: queued.sourceRunId,
        microSkillContent,
        targetSkill,
        reviewReason,
        existingClassificationId: queued.id,
      });

      input.emit(`  Bucket: ${queued.bucket.displayName}`);
      input.emit(`  Role: ${finalClassification.roleType}`);
      input.emit(`  Action: ${actionResult.action}`);

      if (actionResult.skillCreated) {
        skillsCreated += 1;
      }
      if (actionResult.referenceAttached) {
        referencesAttached += 1;
      }
      if (actionResult.triaged) {
        triaged += 1;
      }

      input.onBookmarkStep?.(
        queued.bookmarkId,
        actionResult.action === "created_micro_skill" ||
          actionResult.action === "updated_micro_skill"
          ? "micro_skill"
          : actionResult.referenceAttached
            ? "reference"
            : actionResult.triaged
              ? "triaged"
              : "done",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      input.emit(`  ERROR: ${message}`);
      console.error(
        `[pipeline] Error generating micro-skill for bookmark ${queued.bookmarkId}:`,
        error,
      );
      input.onBookmarkStep?.(queued.bookmarkId, "failed");
    }
  }

  return {
    enriched,
    enrichmentCount,
    failedEnrichments,
    skillsCreated,
    referencesAttached,
    triaged,
  };
}

export async function runClassificationPipeline(options?: {
  reclassify?: boolean;
  force?: boolean;
  onLog?: (message: string) => void;
  onBookmarkStep?: (bookmarkId: string, step: string) => void;
}): Promise<PipelineResult> {
  const reclassify = options?.reclassify ?? false;
  const force = options?.force ?? false;
  const onLog = options?.onLog;
  const onBookmarkStep = options?.onBookmarkStep;
  const startTime = Date.now();
  const lockRunId = `classify-${startTime}`;

  const log: string[] = [];
  function emit(message: string) {
    log.push(message);
    onLog?.(message);
  }

  const lockAcquired = await acquireClassificationLock(lockRunId);
  if (!lockAcquired) {
    emit("Classification already in progress");

    const snapshotBuckets = await prisma.bucket.findMany({
      select: { id: true },
    });
    const snapshotTierMap = await getBucketTierMap(
      snapshotBuckets.map((bucket) => bucket.id),
    );
    const snapshotAudienceMap = await getBucketAudienceMap(
      snapshotBuckets.map((bucket) => bucket.id),
    );
    const snapshotAgentBucketIds = snapshotBuckets
      .filter(
        (bucket) =>
          snapshotTierMap[bucket.id] === "REAL" &&
          snapshotAudienceMap[bucket.id] === "AGENT",
      )
      .map((bucket) => bucket.id);
    const snapshotPendingWhere = reclassify
      ? {
          bucketAssignments: {
            some: {
              isPrimary: true,
              bucketId: { in: snapshotAgentBucketIds },
            },
          },
        }
      : agentPendingBookmarkWhere(snapshotAgentBucketIds);
    const [
      discoveryPendingCount,
      pendingCount,
      queuedMicroSkillCount,
      dirtyBucketCount,
    ] = await Promise.all([
      prisma.bookmark.count({ where: pendingBucketDiscoveryWhere() }),
      prisma.bookmark.count({ where: snapshotPendingWhere }),
      prisma.bookmarkClassification.count({ where: queuedMicroSkillWhere() }),
      countDirtyRealAgentBuckets(),
    ]);

    return {
      discoveredCount: 0,
      processed: 0,
      enriched: 0,
      classified: 0,
      skillsCreated: 0,
      referencesAttached: 0,
      triaged: 0,
      bucketsRefreshed: 0,
      discoveryPendingCount,
      pendingCount,
      queuedMicroSkillCount,
      dirtyBucketCount,
      undecidedBucketCount: snapshotBuckets.filter(
        (bucket) =>
          snapshotTierMap[bucket.id] === "REAL" &&
          snapshotAudienceMap[bucket.id] === "UNDECIDED",
      ).length,
      log,
    };
  }

  try {
    const initialBucketRows = await prisma.bucket.findMany({
      select: { id: true, name: true, displayName: true, description: true },
    });
    let bucketTierMap: Record<string, BucketTier> = await getBucketTierMap(
      initialBucketRows.map((bucket) => bucket.id),
    );
    let existingBuckets: BucketSummary[] = initialBucketRows.map((bucket) => ({
      ...bucket,
      tier: bucketTierMap[bucket.id] ?? "SUGGESTED",
    }));
    let bucketAudienceMap: Record<string, BucketAudience> =
      await getBucketAudienceMap(existingBuckets.map((bucket) => bucket.id));
    let agentBucketIds = existingBuckets
      .filter(
        (bucket) =>
          bucketTierMap[bucket.id] === "REAL" &&
          bucketAudienceMap[bucket.id] === "AGENT",
      )
      .map((bucket) => bucket.id);
    let pendingWhere = reclassify
      ? {
          bucketAssignments: {
            some: {
              isPrimary: true,
              bucketId: { in: agentBucketIds },
            },
          },
        }
      : agentPendingBookmarkWhere(agentBucketIds);

    const [
      initialDiscoveryPendingCount,
      initialPendingCount,
      initialQueuedMicroSkillCount,
      initialDirtyBucketCount,
    ] = await Promise.all([
      prisma.bookmark.count({ where: pendingBucketDiscoveryWhere() }),
      prisma.bookmark.count({ where: pendingWhere }),
      prisma.bookmarkClassification.count({ where: queuedMicroSkillWhere() }),
      countDirtyRealAgentBuckets(),
    ]);
    const initialUndecidedBucketCount = existingBuckets.filter(
      (bucket) =>
        bucketTierMap[bucket.id] === "REAL" &&
        bucketAudienceMap[bucket.id] === "UNDECIDED",
    ).length;
    const initialRealAgentBucketCount = agentBucketIds.length;

    if (
      initialBucketRows.length > 0 &&
      initialRealAgentBucketCount === 0 &&
      initialDiscoveryPendingCount === 0
    ) {
      emit(
        "Guided bucket onboarding is required before agent classification can continue.",
      );
      return {
        discoveredCount: 0,
        processed: 0,
        enriched: 0,
        classified: 0,
        skillsCreated: 0,
        referencesAttached: 0,
        triaged: 0,
        bucketsRefreshed: 0,
        needsBucketReview: true,
        discoveryPendingCount: initialDiscoveryPendingCount,
        pendingCount: initialPendingCount,
        queuedMicroSkillCount: initialQueuedMicroSkillCount,
        dirtyBucketCount: initialDirtyBucketCount,
        undecidedBucketCount: initialUndecidedBucketCount,
        log,
      };
    }

    if (
      initialDiscoveryPendingCount === 0 &&
      initialPendingCount === 0 &&
      initialQueuedMicroSkillCount === 0 &&
      initialDirtyBucketCount === 0 &&
      initialUndecidedBucketCount === 0
    ) {
      emit("No bookmarks or skills pending work");
      return {
        discoveredCount: 0,
        processed: 0,
        enriched: 0,
        classified: 0,
        skillsCreated: 0,
        referencesAttached: 0,
        triaged: 0,
        bucketsRefreshed: 0,
        discoveryPendingCount: 0,
        pendingCount: 0,
        queuedMicroSkillCount: 0,
        dirtyBucketCount: 0,
        undecidedBucketCount: 0,
        log,
      };
    }

    let totalProcessed = 0;
    let totalDiscovered = 0;
    let totalEnriched = 0;
    let totalClassified = 0;
    let totalSkillsCreated = 0;
    let totalReferencesAttached = 0;
    let totalTriaged = 0;
    let totalFailedEnrichments = 0;
    let totalEnrichmentCount = 0;
    let totalBucketsRefreshed = 0;

    if (initialDiscoveryPendingCount > 0) {
      emit(`${initialDiscoveryPendingCount} bookmarks pending bucket discovery`);
    }

    if (!force) {
      const estimatedCost =
        (initialDiscoveryPendingCount + initialPendingCount) *
        appConfig.estimatedClassificationCostUsd;
      const monthSpend = await getCurrentMonthSpend();
      const budgetRemaining = appConfig.monthlyBudgetUsd - monthSpend;

      if (
        initialDiscoveryPendingCount + initialPendingCount > 0 &&
        estimatedCost > budgetRemaining &&
        budgetRemaining <= 0
      ) {
        emit(
          `Budget exceeded — monthly budget remaining $${budgetRemaining.toFixed(2)}`,
        );
        return {
          discoveredCount: 0,
          processed: 0,
          enriched: 0,
          classified: 0,
          skillsCreated: 0,
          referencesAttached: 0,
          triaged: 0,
          bucketsRefreshed: 0,
          blocked: true,
          discoveryPendingCount: initialDiscoveryPendingCount,
          pendingCount: initialPendingCount,
          queuedMicroSkillCount: initialQueuedMicroSkillCount,
          dirtyBucketCount: initialDirtyBucketCount,
          undecidedBucketCount: initialUndecidedBucketCount,
          estimatedCost,
          budgetRemaining,
          log,
        };
      }
    }

    let continueDiscovery = true;
    while (continueDiscovery) {
      if (Date.now() - startTime >= MAX_WALL_CLOCK_MS) {
        emit("Stopping bucket discovery to stay within runtime limit");
        break;
      }

      const bookmarks = await prisma.bookmark.findMany({
        where: pendingBucketDiscoveryWhere(),
        orderBy: { bookmarkedAt: "desc" },
        take: BOOKMARK_BATCH_SIZE,
      });

      if (bookmarks.length === 0) {
        break;
      }

      let batchDiscovered = 0;

      for (const bookmark of bookmarks) {
        const withinBudget =
          force || (await canSpend(appConfig.estimatedClassificationCostUsd));
        if (!withinBudget) {
          emit("Budget limit reached — pausing bucket discovery");
          continueDiscovery = false;
          break;
        }

        try {
          const enrichResult = await loadEnrichmentsForClassification({
            bookmark,
            emit,
          });
          totalEnriched += enrichResult.successCount;
          totalEnrichmentCount += enrichResult.totalUrls;
          totalFailedEnrichments += enrichResult.failedCount;

          onBookmarkStep?.(bookmark.id, "classifying");
          emit(`Discovering bucket for ${bookmarkLabel(bookmark)}...`);
          const classification = await classifyBookmark({
            bookmark,
            enrichments: enrichResult.enrichments,
            existingBuckets,
          });

          if (classification.usage) {
            await recordUsage({
              operation: `bookmark-classification:${classification.usage.model}`,
              amountUsd: classification.usage.costUsd,
            });
          }

          const bucket = await ensureBucket({
            name: classification.bucketName,
            displayName: classification.bucketDisplayName,
            description: classification.bucketDescription,
          });
          await assignPrimaryBucket(bookmark.id, bucket.id);

          if (!existingBuckets.some((existing) => existing.id === bucket.id)) {
            existingBuckets = [
              ...existingBuckets,
              {
                id: bucket.id,
                name: bucket.name,
                displayName: bucket.displayName,
                description: bucket.description,
                tier: "SUGGESTED",
              },
            ];
          }

          emit(`  Bucket: ${bucket.displayName}`);
          totalDiscovered += 1;
          batchDiscovered += 1;
          onBookmarkStep?.(bookmark.id, "done");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown error";
          emit(`  ERROR: ${message}`);
          console.error(
            `[pipeline] Error discovering bucket for bookmark ${bookmark.id}:`,
            error,
          );
          onBookmarkStep?.(bookmark.id, "failed");
        }
      }

      continueDiscovery = batchDiscovered === BOOKMARK_BATCH_SIZE;
    }

    const refreshedBucketRows = await prisma.bucket.findMany({
      select: { id: true, name: true, displayName: true, description: true },
    });
    bucketTierMap = await getBucketTierMap(refreshedBucketRows.map((bucket) => bucket.id));
    existingBuckets = refreshedBucketRows.map((bucket) => ({
      ...bucket,
      tier: bucketTierMap[bucket.id] ?? "SUGGESTED",
    }));
    bucketAudienceMap = await getBucketAudienceMap(
      existingBuckets.map((bucket) => bucket.id),
    );
    agentBucketIds = existingBuckets
      .filter(
        (bucket) =>
          bucketTierMap[bucket.id] === "REAL" &&
          bucketAudienceMap[bucket.id] === "AGENT",
      )
      .map((bucket) => bucket.id);
    pendingWhere = reclassify
      ? {
          bucketAssignments: {
            some: {
              isPrimary: true,
              bucketId: { in: agentBucketIds },
            },
          },
        }
      : agentPendingBookmarkWhere(agentBucketIds);

    const [
      pendingCount,
      queuedMicroSkillCount,
      dirtyBucketCount,
      discoveryPendingCount,
    ] = await Promise.all([
      prisma.bookmark.count({ where: pendingWhere }),
      prisma.bookmarkClassification.count({ where: queuedMicroSkillWhere() }),
      countDirtyRealAgentBuckets(),
      prisma.bookmark.count({ where: pendingBucketDiscoveryWhere() }),
    ]);
    const undecidedBucketCount = existingBuckets.filter(
      (bucket) =>
        bucketTierMap[bucket.id] === "REAL" &&
        bucketAudienceMap[bucket.id] === "UNDECIDED",
    ).length;
    const realAgentBucketCount = existingBuckets.filter(
      (bucket) =>
        bucketTierMap[bucket.id] === "REAL" &&
        bucketAudienceMap[bucket.id] === "AGENT",
    ).length;

    if (realAgentBucketCount === 0 && existingBuckets.length > 0) {
      emit(
        "Finish guided bucket onboarding by approving at least one real agent bucket before agent classification can continue.",
      );
      return {
        discoveredCount: totalDiscovered,
        processed: 0,
        enriched: totalEnriched,
        classified: 0,
        skillsCreated: 0,
        referencesAttached: 0,
        triaged: 0,
        bucketsRefreshed: 0,
        needsBucketReview: true,
        discoveryPendingCount,
        pendingCount,
        queuedMicroSkillCount,
        dirtyBucketCount,
        undecidedBucketCount,
        log,
      };
    }

    if (pendingCount > 0) {
      emit(`${pendingCount} agent bookmarks pending classification`);
    }
    if (queuedMicroSkillCount > 0) {
      emit(`${queuedMicroSkillCount} micro-skills pending generation`);
    }
    if (dirtyBucketCount > 0) {
      emit(`${dirtyBucketCount} buckets pending master-skill refresh`);
    }

    let continueLoop = true;
    while (continueLoop) {
      if (Date.now() - startTime >= MAX_WALL_CLOCK_MS) {
        emit("Stopping bookmark classification to stay within runtime limit");
        break;
      }

      const bookmarks = await prisma.bookmark.findMany({
        where: pendingWhere,
        orderBy: { bookmarkedAt: "desc" },
        take: BOOKMARK_BATCH_SIZE,
      });

      if (bookmarks.length === 0) {
        break;
      }

      for (const bookmark of bookmarks) {
        onBookmarkStep?.(bookmark.id, "queue");
      }

      let batchProcessed = 0;

      for (const bookmark of bookmarks) {
        const withinBudget =
          force || (await canSpend(appConfig.estimatedClassificationCostUsd));
        if (!withinBudget) {
          emit(
            "Budget limit reached — pausing remaining bookmark classification",
          );
          continueLoop = false;
          break;
        }

        const existingClassification =
          await prisma.bookmarkClassification.findUnique({
            where: { bookmarkId: bookmark.id },
          });

        if (existingClassification) {
          const needsReplacement =
            reclassify ||
            existingClassification.fallback ||
            existingClassification.bucketId === null ||
            existingClassification.roleType === null;

          if (!needsReplacement) {
            continue;
          }

          await prisma.bookmarkClassification.delete({
            where: { bookmarkId: bookmark.id },
          });
          await prisma.skillReference.deleteMany({
            where: { bookmarkId: bookmark.id },
          });
        }

        try {
          const enrichResult = await loadEnrichmentsForClassification({
            bookmark,
            emit,
          });
          totalEnriched += enrichResult.successCount;
          totalEnrichmentCount += enrichResult.totalUrls;
          totalFailedEnrichments += enrichResult.failedCount;

          onBookmarkStep?.(bookmark.id, "classifying");
          emit(`Classifying ${bookmarkLabel(bookmark)} into bucket and role...`);
          const classification = await classifyBookmark({
            bookmark,
            enrichments: enrichResult.enrichments,
            existingBuckets,
          });

          if (classification.usage) {
            await recordUsage({
              operation: `bookmark-classification:${classification.usage.model}`,
              amountUsd: classification.usage.costUsd,
            });
          }

          const primaryAssignment =
            await prisma.bookmarkBucketAssignment.findFirst({
              where: {
                bookmarkId: bookmark.id,
                isPrimary: true,
              },
              include: {
                bucket: true,
              },
            });

          if (!primaryAssignment?.bucket) {
            emit("  ERROR: missing primary bucket assignment");
            onBookmarkStep?.(bookmark.id, "failed");
            continue;
          }

          const bucket = primaryAssignment.bucket;
          if (
            bucketTierMap[bucket.id] !== "REAL" ||
            bucketAudienceMap[bucket.id] !== "AGENT"
          ) {
            onBookmarkStep?.(bookmark.id, "done");
            continue;
          }

          await ensureMasterSkill(bucket);

          const classificationForBucket: BucketedClassificationOutput = {
            ...classification,
            bucketName: bucket.name,
            bucketDisplayName: bucket.displayName,
            bucketDescription: bucket.description,
          };

          const actionResult = await handleClassification({
            bookmark,
            bucket,
            classification: classificationForBucket,
            runId: null,
            deferMicroSkillGeneration:
              classificationForBucket.roleType === "MICRO_SKILL",
          });

          emit(`  Bucket: ${bucket.displayName}`);
          emit(`  Role: ${classificationForBucket.roleType}`);
          emit(`  Action: ${actionResult.action}`);

          totalClassified += 1;
          totalProcessed += 1;
          batchProcessed += 1;

          if (actionResult.skillCreated) {
            totalSkillsCreated += 1;
          }
          if (actionResult.referenceAttached) {
            totalReferencesAttached += 1;
          }
          if (actionResult.triaged) {
            totalTriaged += 1;
          }

          const finalStep =
            actionResult.action === "created_micro_skill" ||
            actionResult.action === "updated_micro_skill" ||
            actionResult.action === "queued_micro_skill"
              ? "micro_skill"
              : actionResult.referenceAttached
                ? "reference"
                : actionResult.triaged
                  ? "triaged"
                  : classificationForBucket.roleType === "IGNORE"
                    ? "ignored"
                    : "done";

          onBookmarkStep?.(bookmark.id, finalStep);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown error";
          emit(`  ERROR: ${message}`);
          console.error(
            `[pipeline] Error processing bookmark ${bookmark.id}:`,
            error,
          );
          onBookmarkStep?.(bookmark.id, "failed");
        }
      }

      continueLoop = batchProcessed === BOOKMARK_BATCH_SIZE;
    }

    const queuedMicroSkills = await processQueuedMicroSkills({
      maxQueued: MICRO_SKILL_GENERATION_BATCH_SIZE,
      force,
      emit,
      onBookmarkStep,
      startTime,
    });
    totalEnriched += queuedMicroSkills.enriched;
    totalEnrichmentCount += queuedMicroSkills.enrichmentCount;
    totalFailedEnrichments += queuedMicroSkills.failedEnrichments;
    totalSkillsCreated += queuedMicroSkills.skillsCreated;
    totalReferencesAttached += queuedMicroSkills.referencesAttached;
    totalTriaged += queuedMicroSkills.triaged;

    const masterRefresh = await refreshDirtyMasterSkills({
      maxBuckets: MASTER_SKILL_REFRESH_BATCH_SIZE,
      force,
      emit,
    });
    totalBucketsRefreshed += masterRefresh.refreshed;

    const [
      remainingPendingCount,
      remainingQueuedMicroSkillCount,
      remainingDirtyBucketCount,
      remainingDiscoveryPendingCount,
    ] = await Promise.all([
      prisma.bookmark.count({ where: pendingWhere }),
      prisma.bookmarkClassification.count({ where: queuedMicroSkillWhere() }),
      countDirtyRealAgentBuckets(),
      prisma.bookmark.count({ where: pendingBucketDiscoveryWhere() }),
    ]);

    if (remainingDiscoveryPendingCount > 0) {
      emit(
        `${remainingDiscoveryPendingCount} bookmarks still need bucket discovery; another pass will continue automatically.`,
      );
    }
    if (remainingPendingCount > 0) {
      emit(
        `${remainingPendingCount} agent bookmarks still need classification; another pass will continue automatically.`,
      );
    }
    if (remainingQueuedMicroSkillCount > 0) {
      emit(
        `${remainingQueuedMicroSkillCount} micro-skills are still queued for generation.`,
      );
    }
    if (remainingDirtyBucketCount > 0) {
      emit(
        `${remainingDirtyBucketCount} buckets are still waiting for master-skill refresh.`,
      );
    }

    let enrichmentWarning: string | undefined;
    if (
      totalEnrichmentCount > 0 &&
      totalFailedEnrichments / totalEnrichmentCount > 0.3
    ) {
      enrichmentWarning = `${totalFailedEnrichments} of ${totalEnrichmentCount} URLs could not be fetched. Consider enabling Browserbase (BROWSERBASE_API_KEY) or Firecrawl for better results.`;
    }

    emit(
      `Pipeline complete: ${totalDiscovered} bucketed, ${totalProcessed} classified, ${totalSkillsCreated} micro-skills created, ${totalReferencesAttached} references attached, ${totalBucketsRefreshed} master skills refreshed`,
    );

    return {
      discoveredCount: totalDiscovered,
      processed: totalProcessed,
      enriched: totalEnriched,
      classified: totalClassified,
      skillsCreated: totalSkillsCreated,
      referencesAttached: totalReferencesAttached,
      triaged: totalTriaged,
      bucketsRefreshed: totalBucketsRefreshed,
      discoveryPendingCount: remainingDiscoveryPendingCount,
      pendingCount: remainingPendingCount,
      queuedMicroSkillCount: remainingQueuedMicroSkillCount,
      dirtyBucketCount: remainingDirtyBucketCount,
      undecidedBucketCount: 0,
      enrichmentWarning,
      log,
    };
  } finally {
    await releaseClassificationLock(lockRunId);
  }
}
