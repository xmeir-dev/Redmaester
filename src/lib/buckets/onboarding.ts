import Anthropic from "@anthropic-ai/sdk";
import { SkillKind } from "@prisma/client";
import { z } from "zod";

import { calculateAnthropicCostUsd, normalizeAnthropicUsage } from "@/lib/ai/pricing";
import { createRealBucket, mergeBucketIntoTarget, promoteBucket } from "@/lib/buckets/curation";
import type {
  BucketCurationBucket,
  BucketOnboardingBookmarkSample,
  BucketOnboardingDraft,
  BucketOnboardingDraftAction,
} from "@/lib/buckets/curation-types";
import { toKebabCase } from "@/lib/buckets/service";
import { prisma } from "@/lib/db/prisma";
import { recordUsage } from "@/lib/domain/budget";
import { appConfig } from "@/lib/domain/config";
import {
  getBucketAudienceMap,
  getBucketOnboardingState,
  getBucketTierMap,
  markBucketOnboardingCompleted,
  markBucketOnboardingStarted,
  touchBucketOnboardingDraft,
  type BucketAudience,
} from "@/lib/settings/service";

type OnboardingBucket = BucketCurationBucket & {
  name: string;
  bookmarks: BucketOnboardingBookmarkSample[];
};

const PERSONAL_HINTS = [
  "military",
  "sports",
  "movie",
  "movies",
  "travel",
  "personal",
  "lifestyle",
  "fashion",
  "music",
  "photography",
];

const onboardingDraftSchema = z.object({
  drafts: z
    .array(
      z.object({
        bucketId: z.string().optional(),
        draftName: z.string().trim().min(1).max(120),
        draftDescription: z.string().trim().max(300).optional(),
        audience: z.enum(["AGENT", "PERSONAL"]).optional(),
        tier: z.enum(["REAL", "SUGGESTED"]).optional(),
        action: z.enum(["PROMOTE", "MERGE", "CREATE", "KEEP_PERSONAL", "DEFER"]),
        mergeTargetBucketId: z.string().optional(),
        reason: z.string().trim().min(1).max(400),
      }),
    )
    .max(18)
    .default([]),
});

function draftIdForBucket(bucketId: string): string {
  return `draft:bucket:${bucketId}`;
}

function draftIdForCreate(name: string, index: number): string {
  return `draft:create:${toKebabCase(name)}:${index}`;
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }

      const value = block as { type?: string; text?: string };
      return value.type === "text" ? value.text ?? "" : "";
    })
    .join("\n")
    .trim();
}

function parseJsonFromOutput(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse((fenced ? fenced[1] : trimmed).trim());
}

function sampleBookmarksForBucket(
  bucket: OnboardingBucket,
): BucketOnboardingBookmarkSample[] {
  return bucket.bookmarks.slice(0, 3);
}

function looksPersonal(bucket: Pick<OnboardingBucket, "displayName" | "description">): boolean {
  const haystack = `${bucket.displayName} ${bucket.description}`.toLowerCase();
  return PERSONAL_HINTS.some((token) => haystack.includes(token));
}

function deferDraft(bucket: OnboardingBucket, reason: string): BucketOnboardingDraft {
  const samples = sampleBookmarksForBucket(bucket);
  return {
    id: draftIdForBucket(bucket.id),
    bucketId: bucket.id,
    draftName: bucket.displayName,
    draftDescription: bucket.description,
    audience: "UNDECIDED",
    tier: "SUGGESTED",
    action: "DEFER",
    sampleBookmarkIds: samples.map((bookmark) => bookmark.id),
    sampleBookmarks: samples,
    reason,
    origin: "heuristic",
  };
}

function buildHeuristicOnboardingDrafts(
  buckets: OnboardingBucket[],
): BucketOnboardingDraft[] {
  const sortedSuggestedBuckets = buckets
    .filter((bucket) => bucket.tier === "SUGGESTED")
    .sort((a, b) => b.bookmarkCount - a.bookmarkCount);
  const realBuckets = buckets.filter((bucket) => bucket.tier === "REAL");
  const bucketMap = new Map(sortedSuggestedBuckets.map((bucket) => [bucket.id, bucket]));
  const drafts: BucketOnboardingDraft[] = [];
  const coveredBucketIds = new Set<string>();

  for (const bucket of sortedSuggestedBuckets) {
    const bestRealTarget = realBuckets
      .map((candidate) => {
        const source = `${bucket.displayName} ${bucket.description}`.toLowerCase();
        const target = `${candidate.displayName} ${candidate.description}`.toLowerCase();
        let overlap = 0;
        for (const token of source.split(/[^a-z0-9]+/)) {
          if (token.length >= 4 && target.includes(token)) {
            overlap += 1;
          }
        }

        if (
          source.includes(candidate.displayName.toLowerCase()) ||
          target.includes(bucket.displayName.toLowerCase())
        ) {
          overlap += 2;
        }

        return { candidate, score: overlap };
      })
      .sort((a, b) => b.score - a.score)[0];

    if (bestRealTarget && bestRealTarget.score >= 3) {
      const samples = sampleBookmarksForBucket(bucket);
      drafts.push({
        id: draftIdForBucket(bucket.id),
        bucketId: bucket.id,
        draftName: bucket.displayName,
        draftDescription: bucket.description,
        audience:
          bestRealTarget.candidate.audience === "PERSONAL" ? "PERSONAL" : "AGENT",
        tier: "REAL",
        action: "MERGE",
        mergeTargetBucketId: bestRealTarget.candidate.id,
        sampleBookmarkIds: samples.map((bookmark) => bookmark.id),
        sampleBookmarks: samples,
        reason: `This bucket overlaps strongly with ${bestRealTarget.candidate.displayName}, so it should probably fold into that existing bucket.`,
        origin: "heuristic",
      });
      coveredBucketIds.add(bucket.id);
    }
  }

  const topAgentCandidates = sortedSuggestedBuckets.filter(
    (bucket) => !coveredBucketIds.has(bucket.id) && !looksPersonal(bucket),
  );
  for (const bucket of topAgentCandidates.slice(0, 2)) {
    const samples = sampleBookmarksForBucket(bucket);
    drafts.push({
      id: draftIdForBucket(bucket.id),
      bucketId: bucket.id,
      draftName: bucket.displayName,
      draftDescription: bucket.description,
      audience: "AGENT",
      tier: "REAL",
      action: "PROMOTE",
      sampleBookmarkIds: samples.map((bookmark) => bookmark.id),
      sampleBookmarks: samples,
      reason:
        bucket.bookmarkCount >= 5
          ? "This looks like a strong starter agent bucket with enough signal to begin classification."
          : "This is a reasonable first durable bucket so you can start classification quickly.",
      origin: "heuristic",
    });
    coveredBucketIds.add(bucket.id);
  }

  const personalCandidate = sortedSuggestedBuckets.find(
    (bucket) =>
      !coveredBucketIds.has(bucket.id) &&
      looksPersonal(bucket) &&
      bucket.bookmarkCount >= 2,
  );
  if (personalCandidate) {
    const samples = sampleBookmarksForBucket(personalCandidate);
    drafts.push({
      id: draftIdForBucket(personalCandidate.id),
      bucketId: personalCandidate.id,
      draftName: personalCandidate.displayName,
      draftDescription: personalCandidate.description,
      audience: "PERSONAL",
      tier: "REAL",
      action: "KEEP_PERSONAL",
      sampleBookmarkIds: samples.map((bookmark) => bookmark.id),
      sampleBookmarks: samples,
      reason:
        "This bucket looks more useful for personal browsing than agent-facing skill generation.",
      origin: "heuristic",
    });
    coveredBucketIds.add(personalCandidate.id);
  }

  if (!drafts.some((draft) => draft.action === "PROMOTE" && draft.audience === "AGENT")) {
    const fallback = sortedSuggestedBuckets.find((bucket) => !coveredBucketIds.has(bucket.id));
    if (fallback) {
      const samples = sampleBookmarksForBucket(fallback);
      drafts.unshift({
        id: draftIdForBucket(fallback.id),
        bucketId: fallback.id,
        draftName: fallback.displayName,
        draftDescription: fallback.description,
        audience: "AGENT",
        tier: "REAL",
        action: "PROMOTE",
        sampleBookmarkIds: samples.map((bookmark) => bookmark.id),
        sampleBookmarks: samples,
        reason: "You only need one solid real agent bucket to start, so this is the fastest starter choice.",
        origin: "heuristic",
      });
      coveredBucketIds.add(fallback.id);
    }
  }

  for (const bucket of sortedSuggestedBuckets) {
    if (coveredBucketIds.has(bucket.id)) {
      continue;
    }

    drafts.push(
      deferDraft(
        bucket,
        "Defer this suggested bucket for later. It can stay editable without blocking onboarding.",
      ),
    );
  }

  return drafts;
}

async function fetchOnboardingBuckets(): Promise<OnboardingBucket[]> {
  const buckets = await prisma.bucket.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      _count: {
        select: {
          bookmarkAssignments: true,
        },
      },
      bookmarkAssignments: {
        orderBy: {
          createdAt: "desc",
        },
        take: 4,
        select: {
          bookmark: {
            select: {
              id: true,
              text: true,
              authorHandle: true,
              url: true,
            },
          },
        },
      },
      skills: {
        select: {
          kind: true,
        },
      },
    },
  });

  const [tierMap, audienceMap] = await Promise.all([
    getBucketTierMap(buckets.map((bucket) => bucket.id)),
    getBucketAudienceMap(buckets.map((bucket) => bucket.id)),
  ]);

  return buckets.map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    displayName: bucket.displayName,
    description: bucket.description,
    tier: tierMap[bucket.id] ?? "SUGGESTED",
    audience: audienceMap[bucket.id] ?? "UNDECIDED",
    bookmarkCount: bucket._count.bookmarkAssignments,
    microSkillCount: bucket.skills.filter((skill) => skill.kind === SkillKind.MICRO)
      .length,
    bookmarks: bucket.bookmarkAssignments.map((assignment) => ({
      id: assignment.bookmark.id,
      text: assignment.bookmark.text,
      authorHandle: assignment.bookmark.authorHandle,
      url: assignment.bookmark.url,
    })),
  }));
}

function fillDeferredDrafts(
  drafts: BucketOnboardingDraft[],
  buckets: OnboardingBucket[],
): BucketOnboardingDraft[] {
  const coveredBucketIds = new Set(
    drafts.map((draft) => draft.bucketId).filter((bucketId): bucketId is string => Boolean(bucketId)),
  );

  const deferred = buckets
    .filter(
      (bucket) =>
        bucket.tier === "SUGGESTED" &&
        !coveredBucketIds.has(bucket.id),
    )
    .map((bucket) =>
      deferDraft(
        bucket,
        "Defer this suggestion for now. You can come back to it later in the advanced editor.",
      ),
    );

  return [...drafts, ...deferred];
}

function normalizeAiDrafts(
  rawDrafts: z.infer<typeof onboardingDraftSchema>["drafts"],
  buckets: OnboardingBucket[],
): BucketOnboardingDraft[] {
  const bucketMap = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  const normalized: BucketOnboardingDraft[] = [];
  const seenIds = new Set<string>();

  rawDrafts.forEach((draft, index) => {
    if (draft.action === "CREATE") {
      const createId = draftIdForCreate(draft.draftName, index);
      if (seenIds.has(createId)) {
        return;
      }

      seenIds.add(createId);
      normalized.push({
        id: createId,
        draftName: draft.draftName,
        draftDescription:
          draft.draftDescription?.trim() ||
          `Durable bucket for ${draft.draftName}.`,
        audience: draft.audience ?? "AGENT",
        tier: "REAL",
        action: "CREATE",
        sampleBookmarkIds: [],
        sampleBookmarks: [],
        reason: draft.reason,
        origin: "curator",
      });
      return;
    }

    if (!draft.bucketId) {
      return;
    }

    const bucket = bucketMap.get(draft.bucketId);
    if (!bucket) {
      return;
    }

    if (
      draft.action === "MERGE" &&
      (!draft.mergeTargetBucketId ||
        !bucketMap.has(draft.mergeTargetBucketId) ||
        draft.mergeTargetBucketId === bucket.id)
    ) {
      return;
    }

    const draftId = draftIdForBucket(bucket.id);
    if (seenIds.has(draftId)) {
      return;
    }

    const samples = sampleBookmarksForBucket(bucket);
    seenIds.add(draftId);
    normalized.push({
      id: draftId,
      bucketId: bucket.id,
      draftName: draft.draftName || bucket.displayName,
      draftDescription: draft.draftDescription?.trim() || bucket.description,
      audience:
        draft.action === "KEEP_PERSONAL"
          ? "PERSONAL"
          : draft.action === "DEFER"
            ? "UNDECIDED"
            : draft.audience ?? "AGENT",
      tier: draft.action === "DEFER" ? "SUGGESTED" : "REAL",
      action: draft.action,
      mergeTargetBucketId: draft.mergeTargetBucketId,
      sampleBookmarkIds: samples.map((bookmark) => bookmark.id),
      sampleBookmarks: samples,
      reason: draft.reason,
      origin: "curator",
    });
  });

  return normalized;
}

async function generateAiOnboardingDrafts(
  buckets: OnboardingBucket[],
): Promise<{ drafts: BucketOnboardingDraft[]; usedModel: string } | null> {
  if (!process.env.ANTHROPIC_API_KEY || buckets.length === 0) {
    return null;
  }

  const prompt = [
    "You are Redmaester onboarding curator.",
    "Return only JSON.",
    "Create a compact first-run bucket plan for a user who just imported bookmarks.",
    "Product rules:",
    "- The user only needs one real AGENT bucket to begin classification.",
    "- Keep the starter plan small and opinionated.",
    "- Prefer 1-3 real AGENT buckets max.",
    "- Optionally include 0-2 real PERSONAL buckets.",
    "- Defer the rest.",
    "- Use MERGE only when the merge target is an existing bucket id from the inventory below.",
    "- CREATE is allowed when no existing bucket fits, but do not create more than two new buckets.",
    "- Suggested buckets left out of your response will be deferred automatically.",
    "- Do not output partial-bookmark moves in onboarding. Whole-bucket actions only.",
    "",
    "Action semantics:",
    "- PROMOTE: promote an existing suggested bucket into a real AGENT bucket",
    "- KEEP_PERSONAL: promote an existing suggested bucket into a real PERSONAL bucket",
    "- MERGE: merge one existing bucket into one existing target bucket",
    "- CREATE: create a new real bucket",
    "- DEFER: keep a suggested bucket unresolved for later",
    "",
    "Bucket inventory:",
    ...buckets.map((bucket) => {
      const samples =
        bucket.bookmarks.length > 0
          ? bucket.bookmarks
              .slice(0, 2)
              .map(
                (bookmark) =>
                  `@${bookmark.authorHandle}: ${bookmark.text.replace(/\s+/g, " ").slice(0, 120)}`,
              )
              .join(" | ")
          : "no sample bookmarks";
      return `- id=${bucket.id}; name=${bucket.displayName}; tier=${bucket.tier}; audience=${bucket.audience}; bookmarks=${bucket.bookmarkCount}; micro_skills=${bucket.microSkillCount}; description=${bucket.description}; samples=${samples}`;
    }),
    "",
    "Return JSON matching this schema:",
    `{"drafts":[{"bucketId":"existing_bucket_id_optional","draftName":"visible bucket name","draftDescription":"short description","audience":"AGENT|PERSONAL","tier":"REAL|SUGGESTED","action":"PROMOTE|MERGE|CREATE|KEEP_PERSONAL|DEFER","mergeTargetBucketId":"existing_bucket_id_for_merge_only","reason":"short explanation"}]}`,
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create(
      {
        model: appConfig.chatModel,
        temperature: 0.1,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: appConfig.chatModelTimeoutMs },
    );

    const parsed = onboardingDraftSchema.parse(
      parseJsonFromOutput(textFromContent(response.content)),
    );
    const model = String(response.model ?? appConfig.chatModel);
    const usage = normalizeAnthropicUsage(response.usage);
    const amountUsd = calculateAnthropicCostUsd(model, usage);

    if (amountUsd > 0) {
      await recordUsage({
        operation: "bucket_onboarding_draft",
        amountUsd,
      });
    }

    const drafts = normalizeAiDrafts(parsed.drafts, buckets);
    return {
      drafts,
      usedModel: model,
    };
  } catch (error) {
    console.error("[bucket-onboarding] AI draft generation failed:", error);
    return null;
  }
}

export async function generateBucketOnboardingDrafts(): Promise<{
  drafts: BucketOnboardingDraft[];
  usedModel: string;
  onboarding: Awaited<ReturnType<typeof getBucketOnboardingState>>;
}> {
  const [buckets, onboarding] = await Promise.all([
    fetchOnboardingBuckets(),
    getBucketOnboardingState(),
  ]);

  if (buckets.length === 0) {
    return {
      drafts: [],
      usedModel: "heuristic-onboarding",
      onboarding,
    };
  }

  await Promise.all([
    markBucketOnboardingStarted(),
    touchBucketOnboardingDraft(),
  ]);

  const aiDraftResult = await generateAiOnboardingDrafts(buckets);
  const heuristicDrafts = buildHeuristicOnboardingDrafts(buckets);

  let drafts =
    aiDraftResult?.drafts && aiDraftResult.drafts.length > 0
      ? fillDeferredDrafts(aiDraftResult.drafts, buckets)
      : fillDeferredDrafts(heuristicDrafts, buckets);

  const hasStarterAgentDraft =
    drafts.some(
      (draft) =>
        (draft.action === "PROMOTE" || draft.action === "CREATE") &&
        draft.audience === "AGENT",
    ) ||
    buckets.some((bucket) => bucket.tier === "REAL" && bucket.audience === "AGENT");

  if (!hasStarterAgentDraft) {
    drafts = fillDeferredDrafts(heuristicDrafts, buckets);
  }

  return {
    drafts,
    usedModel: aiDraftResult?.usedModel ?? "heuristic-onboarding",
    onboarding: {
      ...onboarding,
      startedAt: onboarding.startedAt ?? new Date().toISOString(),
      lastDraftAt: new Date().toISOString(),
    },
  };
}

async function updateBucketDetails(
  bucketId: string,
  input: { draftName: string; draftDescription: string },
): Promise<void> {
  const displayName = input.draftName.trim();
  const description = input.draftDescription.trim();

  await prisma.bucket.update({
    where: { id: bucketId },
    data: {
      ...(displayName ? { displayName } : {}),
      ...(description ? { description } : {}),
    },
  });
}

function activeTargetDrafts(drafts: BucketOnboardingDraft[]) {
  const map = new Map<string, string>();

  for (const draft of drafts) {
    if (
      draft.bucketId &&
      (draft.action === "PROMOTE" || draft.action === "KEEP_PERSONAL")
    ) {
      map.set(draft.id, draft.bucketId);
    }
  }

  return map;
}

export async function applyBucketOnboardingDrafts(
  drafts: BucketOnboardingDraft[],
): Promise<{
  completed: boolean;
  appliedCount: number;
  createdCount: number;
  promotedCount: number;
  mergedCount: number;
  deferredCount: number;
  realAgentBucketCount: number;
  onboarding: Awaited<ReturnType<typeof getBucketOnboardingState>>;
}> {
  await markBucketOnboardingStarted();

  const normalizedDrafts = drafts.filter((draft, index, array) => {
    return array.findIndex((candidate) => candidate.id === draft.id) === index;
  });

  const targetDraftMap = activeTargetDrafts(normalizedDrafts);
  let createdCount = 0;
  let promotedCount = 0;
  let mergedCount = 0;
  let deferredCount = 0;

  for (const draft of normalizedDrafts) {
    if (draft.action !== "CREATE") {
      continue;
    }

    const createdBucket = await createRealBucket({
      displayName: draft.draftName.trim(),
      description: draft.draftDescription.trim() || undefined,
      audience: draft.audience === "PERSONAL" ? "PERSONAL" : "AGENT",
    });
    targetDraftMap.set(draft.id, createdBucket.id);
    createdCount += 1;
  }

  for (const draft of normalizedDrafts) {
    if (!draft.bucketId) {
      if (draft.action === "DEFER") {
        deferredCount += 1;
      }
      continue;
    }

    if (draft.action === "PROMOTE" || draft.action === "KEEP_PERSONAL") {
      await updateBucketDetails(draft.bucketId, {
        draftName: draft.draftName,
        draftDescription: draft.draftDescription,
      });
      await promoteBucket({
        bucketId: draft.bucketId,
        audience:
          draft.action === "KEEP_PERSONAL"
            ? "PERSONAL"
            : draft.audience === "PERSONAL"
              ? "PERSONAL"
              : "AGENT",
      });
      promotedCount += 1;
      continue;
    }

    if (draft.action === "MERGE") {
      const targetBucketId =
        (draft.mergeTargetBucketId
          ? targetDraftMap.get(draft.mergeTargetBucketId) ?? draft.mergeTargetBucketId
          : null) ?? null;

      if (!targetBucketId) {
        deferredCount += 1;
        continue;
      }

      await mergeBucketIntoTarget({
        sourceBucketId: draft.bucketId,
        targetBucketId,
      });
      mergedCount += 1;
      continue;
    }

    if (draft.action === "DEFER") {
      await updateBucketDetails(draft.bucketId, {
        draftName: draft.draftName,
        draftDescription: draft.draftDescription,
      });
      deferredCount += 1;
    }
  }

  const buckets = await prisma.bucket.findMany({
    select: { id: true },
  });
  const [tierMap, audienceMap] = await Promise.all([
    getBucketTierMap(buckets.map((bucket) => bucket.id)),
    getBucketAudienceMap(buckets.map((bucket) => bucket.id)),
  ]);
  const realAgentBucketCount = buckets.filter(
    (bucket) =>
      tierMap[bucket.id] === "REAL" && audienceMap[bucket.id] === "AGENT",
  ).length;

  if (realAgentBucketCount > 0) {
    await markBucketOnboardingCompleted();
  }

  return {
    completed: realAgentBucketCount > 0,
    appliedCount:
      createdCount + promotedCount + mergedCount + deferredCount,
    createdCount,
    promotedCount,
    mergedCount,
    deferredCount,
    realAgentBucketCount,
    onboarding: await getBucketOnboardingState(),
  };
}
