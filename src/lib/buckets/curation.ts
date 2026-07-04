import Anthropic from "@anthropic-ai/sdk";
import { SkillKind, TriageStatus } from "@prisma/client";
import { z } from "zod";

import { calculateAnthropicCostUsd, normalizeAnthropicUsage } from "@/lib/ai/pricing";
import { ensureBucket, ensureMasterSkill } from "@/lib/buckets/service";
import type {
  BucketCurationBucket,
  BucketCurationSuggestion,
} from "@/lib/buckets/curation-types";
import { prisma } from "@/lib/db/prisma";
import { recordUsage } from "@/lib/domain/budget";
import { appConfig } from "@/lib/domain/config";
import {
  getBucketAudience,
  getBucketTier,
  getBucketAudienceMap,
  getBucketTierMap,
  setBucketAudience,
  setBucketTier,
  type BucketAudience,
} from "@/lib/settings/service";

const STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "from",
  "into",
  "about",
  "knowledge",
  "bucket",
  "strategy",
  "strategies",
  "tactics",
  "systems",
  "system",
  "ideas",
  "idea",
  "using",
  "related",
  "that",
  "this",
  "your",
  "their",
  "agent",
  "personal",
]);

const curatorSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        action: z.enum([
          "PROMOTE_BUCKET",
          "MERGE_BUCKET_INTO",
          "CREATE_REAL_BUCKET",
          "CREATE_AND_MERGE",
        ]),
        title: z.string().min(1),
        reason: z.string().min(1),
        sourceBucketIds: z.array(z.string()).default([]),
        targetBucketId: z.string().optional(),
        targetDisplayName: z.string().optional(),
        targetDescription: z.string().optional(),
        audience: z.enum(["AGENT", "PERSONAL"]).optional(),
      }),
    )
    .max(6)
    .default([]),
});

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function suggestionId(parts: string[]): string {
  return parts
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join(":");
}

// Token-overlap similarity between two buckets (name + description), in
// [0, ~1]: shared tokens divided by the larger token set, plus a 1.5 bonus
// when one bucket's name contains the other's. Used to decide whether a
// SUGGESTED bucket should merge into an existing REAL one (threshold 0.34
// below — tuned by eye to catch "UX" vs "UX & UI" without merging
// unrelated topics).
function scoreSimilarity(source: BucketCurationBucket, target: BucketCurationBucket): number {
  const sourceTokens = new Set(
    tokenize(`${source.displayName} ${source.description}`),
  );
  const targetTokens = new Set(
    tokenize(`${target.displayName} ${target.description}`),
  );

  if (sourceTokens.size === 0 || targetTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of sourceTokens) {
    if (targetTokens.has(token)) {
      overlap += 1;
    }
  }

  const sourceName = source.displayName.toLowerCase();
  const targetName = target.displayName.toLowerCase();
  if (
    sourceName.includes(targetName) ||
    targetName.includes(sourceName) ||
    source.description.toLowerCase().includes(targetName)
  ) {
    overlap += 1.5;
  }

  return overlap / Math.max(sourceTokens.size, targetTokens.size);
}

function dedupeSuggestions(
  suggestions: BucketCurationSuggestion[],
): BucketCurationSuggestion[] {
  const seen = new Set<string>();
  const result: BucketCurationSuggestion[] = [];

  for (const suggestion of suggestions) {
    if (seen.has(suggestion.id)) {
      continue;
    }
    seen.add(suggestion.id);
    result.push(suggestion);
  }

  return result;
}

function findMentionedBuckets(
  instruction: string,
  buckets: BucketCurationBucket[],
): BucketCurationBucket[] {
  const normalized = instruction.toLowerCase();
  return buckets.filter((bucket) => {
    const displayName = bucket.displayName.toLowerCase();
    return normalized.includes(displayName);
  });
}

function cleanTargetName(raw: string): string {
  return raw
    .replace(/\b(bucket|please|maybe|probably|should|into|part of)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "")
    .trim();
}

function findBucketByName(
  targetName: string,
  buckets: BucketCurationBucket[],
): BucketCurationBucket | null {
  const normalizedTarget = targetName.toLowerCase().trim();
  if (!normalizedTarget) {
    return null;
  }

  return (
    buckets.find(
      (bucket) => bucket.displayName.toLowerCase() === normalizedTarget,
    ) ??
    buckets.find((bucket) =>
      bucket.displayName.toLowerCase().includes(normalizedTarget),
    ) ??
    buckets.find((bucket) =>
      normalizedTarget.includes(bucket.displayName.toLowerCase()),
    ) ??
    null
  );
}

function buildInstructionFallbackSuggestions(
  instruction: string,
  buckets: BucketCurationBucket[],
): BucketCurationSuggestion[] {
  const normalizedInstruction = instruction.toLowerCase();
  const audience: BucketAudience = normalizedInstruction.includes("personal")
    ? "PERSONAL"
    : "AGENT";
  const mentionedBuckets = findMentionedBuckets(instruction, buckets);

  const createMatch =
    instruction.match(/create (?:a |an )?(?:real )?bucket called ([^.,]+?)(?: and|$)/i) ??
    instruction.match(/create (?:a |an )?(?:real )?bucket named ([^.,]+?)(?: and|$)/i);
  const partOfMatch =
    instruction.match(/part of (?:an? )?([^.,]+?)(?: bucket|$|[.,])/i) ??
    instruction.match(/into (?:an? )?([^.,]+?)(?: bucket|$|[.,])/i);
  const promoteMatch =
    instruction.match(/(?:make|promote) ([^.,]+?) (?:a )?real bucket/i);

  const explicitTargetName = cleanTargetName(
    createMatch?.[1] ?? partOfMatch?.[1] ?? "",
  );
  const existingTarget = explicitTargetName
    ? findBucketByName(explicitTargetName, buckets)
    : null;

  if (explicitTargetName && mentionedBuckets.length > 0) {
    if (existingTarget) {
      const sourceBuckets = mentionedBuckets.filter(
        (bucket) => bucket.id !== existingTarget.id,
      );
      if (sourceBuckets.length > 0) {
        return [
          {
            id: suggestionId([
              "instruction-merge",
              existingTarget.id,
              sourceBuckets.map((bucket) => bucket.id).join(","),
            ]),
            action: "MERGE_BUCKET_INTO",
            origin: "heuristic",
            title: `Fold ${sourceBuckets
              .map((bucket) => bucket.displayName)
              .join(", ")} into ${existingTarget.displayName}`,
            reason:
              "This matches your instruction directly, so the safest next step is to consolidate those suggested buckets into the target bucket.",
            sourceBucketIds: sourceBuckets.map((bucket) => bucket.id),
            sourceBucketNames: sourceBuckets.map((bucket) => bucket.displayName),
            targetBucketId: existingTarget.id,
            targetDisplayName: existingTarget.displayName,
            audience,
            preview: {
              bookmarkCount: sourceBuckets.reduce(
                (total, bucket) => total + bucket.bookmarkCount,
                0,
              ),
              microSkillCount: sourceBuckets.reduce(
                (total, bucket) => total + bucket.microSkillCount,
                0,
              ),
            },
          },
        ];
      }
    }

    return [
      {
        id: suggestionId([
          "instruction-create-and-merge",
          explicitTargetName,
          mentionedBuckets.map((bucket) => bucket.id).join(","),
        ]),
        action: mentionedBuckets.length > 0 ? "CREATE_AND_MERGE" : "CREATE_REAL_BUCKET",
        origin: "heuristic",
        title:
          mentionedBuckets.length > 0
            ? `Create ${explicitTargetName} and fold in ${mentionedBuckets
                .map((bucket) => bucket.displayName)
                .join(", ")}`
            : `Create ${explicitTargetName} as a real bucket`,
        reason:
          "This matches your instruction directly and creates a durable target bucket the classifier can reuse later.",
        sourceBucketIds: mentionedBuckets.map((bucket) => bucket.id),
        sourceBucketNames: mentionedBuckets.map((bucket) => bucket.displayName),
        targetDisplayName: explicitTargetName,
        targetDescription: `Durable bucket for ${explicitTargetName}.`,
        audience,
        preview: {
          bookmarkCount: mentionedBuckets.reduce(
            (total, bucket) => total + bucket.bookmarkCount,
            0,
          ),
          microSkillCount: mentionedBuckets.reduce(
            (total, bucket) => total + bucket.microSkillCount,
            0,
          ),
        },
      },
    ];
  }

  if (promoteMatch) {
    const targetBucket = findBucketByName(cleanTargetName(promoteMatch[1]), buckets);
    if (targetBucket) {
      return [
        {
          id: suggestionId(["instruction-promote", targetBucket.id]),
          action: "PROMOTE_BUCKET",
          origin: "heuristic",
          title: `Promote ${targetBucket.displayName} into a real bucket`,
          reason: "This matches your instruction directly.",
          sourceBucketIds: [targetBucket.id],
          sourceBucketNames: [targetBucket.displayName],
          audience,
          preview: {
            bookmarkCount: targetBucket.bookmarkCount,
            microSkillCount: targetBucket.microSkillCount,
          },
        },
      ];
    }
  }

  return [];
}

// Model-free curation suggestions (used when the AI curator is unavailable
// or as a baseline). Rules:
// - no REAL buckets yet → suggest promoting the 3 largest SUGGESTED ones
// - SUGGESTED bucket similar to a REAL one (score >= 0.34) → suggest merge
// - otherwise, SUGGESTED buckets with >= 8 bookmarks earn a promote
// Capped at 6 suggestions so the curation UI stays scannable.
export function buildHeuristicBucketSuggestions(
  buckets: BucketCurationBucket[],
): BucketCurationSuggestion[] {
  const realBuckets = buckets.filter((bucket) => bucket.tier === "REAL");
  const suggestedBuckets = buckets
    .filter((bucket) => bucket.tier === "SUGGESTED")
    .sort((a, b) => b.bookmarkCount - a.bookmarkCount);

  const suggestions: BucketCurationSuggestion[] = [];

  if (realBuckets.length === 0) {
    for (const bucket of suggestedBuckets.slice(0, 3)) {
      suggestions.push({
        id: suggestionId(["promote", bucket.id]),
        action: "PROMOTE_BUCKET",
        origin: "heuristic",
        title: `Make ${bucket.displayName} a real bucket`,
        reason:
          bucket.bookmarkCount >= 5
            ? `${bucket.displayName} already has enough bookmarks to justify a durable taxonomy slot.`
            : `${bucket.displayName} is a good candidate to become one of your first durable buckets.`,
        sourceBucketIds: [bucket.id],
        sourceBucketNames: [bucket.displayName],
        audience: "AGENT",
        preview: {
          bookmarkCount: bucket.bookmarkCount,
          microSkillCount: bucket.microSkillCount,
        },
      });
    }

    return suggestions;
  }

  for (const bucket of suggestedBuckets) {
    const bestRealMatch = realBuckets
      .map((candidate) => ({
        candidate,
        score: scoreSimilarity(bucket, candidate),
      }))
      .sort((a, b) => b.score - a.score)[0];

    if (bestRealMatch && bestRealMatch.score >= 0.34) {
      suggestions.push({
        id: suggestionId(["merge", bucket.id, bestRealMatch.candidate.id]),
        action: "MERGE_BUCKET_INTO",
        origin: "heuristic",
        title: `Fold ${bucket.displayName} into ${bestRealMatch.candidate.displayName}`,
        reason: `These buckets overlap semantically, so consolidating them should keep your real taxonomy cleaner.`,
        sourceBucketIds: [bucket.id],
        sourceBucketNames: [bucket.displayName],
        targetBucketId: bestRealMatch.candidate.id,
        targetDisplayName: bestRealMatch.candidate.displayName,
        audience: bestRealMatch.candidate.audience === "PERSONAL" ? "PERSONAL" : "AGENT",
        preview: {
          bookmarkCount: bucket.bookmarkCount,
          microSkillCount: bucket.microSkillCount,
        },
      });
      continue;
    }

    if (bucket.bookmarkCount >= 8) {
      suggestions.push({
        id: suggestionId(["promote", bucket.id]),
        action: "PROMOTE_BUCKET",
        origin: "heuristic",
        title: `Promote ${bucket.displayName} into a real bucket`,
        reason:
          `${bucket.displayName} looks large enough to stand on its own instead of staying a rough suggestion.`,
        sourceBucketIds: [bucket.id],
        sourceBucketNames: [bucket.displayName],
        audience: "AGENT",
        preview: {
          bookmarkCount: bucket.bookmarkCount,
          microSkillCount: bucket.microSkillCount,
        },
      });
    }
  }

  return dedupeSuggestions(suggestions).slice(0, 6);
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

async function fetchCurationBuckets(): Promise<BucketCurationBucket[]> {
  const buckets = await prisma.bucket.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      _count: {
        select: {
          bookmarkAssignments: true,
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
    displayName: bucket.displayName,
    description: bucket.description,
    tier: tierMap[bucket.id] ?? "SUGGESTED",
    audience: audienceMap[bucket.id] ?? "UNDECIDED",
    bookmarkCount: bucket._count.bookmarkAssignments,
    microSkillCount: bucket.skills.filter((skill) => skill.kind === SkillKind.MICRO)
      .length,
  }));
}

function normalizeCuratorSuggestions(
  rawSuggestions: z.infer<typeof curatorSuggestionSchema>["suggestions"],
  buckets: BucketCurationBucket[],
): BucketCurationSuggestion[] {
  const bucketMap = new Map(buckets.map((bucket) => [bucket.id, bucket]));

  const suggestions = rawSuggestions.flatMap((suggestion) => {
    const sourceBuckets = suggestion.sourceBucketIds
      .map((bucketId) => bucketMap.get(bucketId))
      .filter((bucket): bucket is BucketCurationBucket => Boolean(bucket));
    const targetBucket = suggestion.targetBucketId
      ? bucketMap.get(suggestion.targetBucketId)
      : undefined;

    if (
      suggestion.action === "PROMOTE_BUCKET" &&
      sourceBuckets.length !== 1
    ) {
      return [];
    }

    if (
      suggestion.action === "MERGE_BUCKET_INTO" &&
      (!targetBucket || sourceBuckets.length === 0)
    ) {
      return [];
    }

    if (
      suggestion.action === "CREATE_AND_MERGE" &&
      (sourceBuckets.length === 0 || !suggestion.targetDisplayName?.trim())
    ) {
      return [];
    }

    if (
      suggestion.action === "CREATE_REAL_BUCKET" &&
      !suggestion.targetDisplayName?.trim()
    ) {
      return [];
    }

    return [
      {
        id: suggestionId([
          "curator",
          suggestion.action,
          suggestion.targetBucketId ?? suggestion.targetDisplayName ?? "",
          sourceBuckets.map((bucket) => bucket.id).join(","),
        ]),
        action: suggestion.action,
        origin: "curator" as const,
        title: suggestion.title,
        reason: suggestion.reason,
        sourceBucketIds: sourceBuckets.map((bucket) => bucket.id),
        sourceBucketNames: sourceBuckets.map((bucket) => bucket.displayName),
        targetBucketId: targetBucket?.id,
        targetDisplayName:
          targetBucket?.displayName ?? suggestion.targetDisplayName?.trim(),
        targetDescription: suggestion.targetDescription?.trim(),
        audience: suggestion.audience,
        preview: {
          bookmarkCount: sourceBuckets.reduce(
            (total, bucket) => total + bucket.bookmarkCount,
            0,
          ),
          microSkillCount: sourceBuckets.reduce(
            (total, bucket) => total + bucket.microSkillCount,
            0,
          ),
        },
      },
    ];
  });

  return dedupeSuggestions(suggestions).slice(0, 6);
}

export async function suggestBucketActions(
  instruction: string,
): Promise<{ suggestions: BucketCurationSuggestion[]; usedModel: string }> {
  const buckets = await fetchCurationBuckets();
  const heuristicSuggestions = buildHeuristicBucketSuggestions(buckets);
  const trimmed = instruction.trim();
  const instructionSuggestions = buildInstructionFallbackSuggestions(
    trimmed,
    buckets,
  );

  if (!trimmed || !process.env.ANTHROPIC_API_KEY) {
    return {
      suggestions:
        instructionSuggestions.length > 0
          ? instructionSuggestions
          : heuristicSuggestions,
      usedModel:
        instructionSuggestions.length > 0
          ? "instruction-curator"
          : "heuristic-curator",
    };
  }

  const prompt = [
    "You are the Redmaester bucket curator.",
    "Return only JSON.",
    "You are proposing taxonomy actions over bookmark buckets.",
    "Important product rules:",
    "- Suggested buckets are rough AI proposals.",
    "- Real buckets are durable taxonomy.",
    "- Only real agent buckets produce agent-facing classification and skills.",
    "- Prefer merging a suggested bucket into an existing real bucket when that keeps the taxonomy cleaner.",
    "- Create a new real bucket when existing real buckets are not a good fit.",
    "- You may only propose whole-bucket merges. Do not propose partial bookmark moves.",
    "- If the user asks for a partial move, approximate with a create-and-merge suggestion only when it still makes sense at whole-bucket level.",
    "",
    "Allowed actions:",
    "- PROMOTE_BUCKET: promote one existing suggested bucket into a real bucket",
    "- MERGE_BUCKET_INTO: merge one or more existing source buckets into one existing target bucket",
    "- CREATE_REAL_BUCKET: create a new real bucket with no immediate merge",
    "- CREATE_AND_MERGE: create a new real bucket, then merge one or more source buckets into it",
    "",
    "Bucket inventory:",
    ...buckets.map((bucket) =>
      `- id=${bucket.id}; name=${bucket.displayName}; tier=${bucket.tier}; audience=${bucket.audience}; bookmarks=${bucket.bookmarkCount}; micro_skills=${bucket.microSkillCount}; description=${bucket.description}`,
    ),
    "",
    `User instruction: ${instruction.trim()}`,
    "",
    "Return JSON that matches this shape:",
    `{"suggestions":[{"action":"PROMOTE_BUCKET|MERGE_BUCKET_INTO|CREATE_REAL_BUCKET|CREATE_AND_MERGE","title":"...","reason":"...","sourceBucketIds":["bucket_id"],"targetBucketId":"existing_bucket_id_if_needed","targetDisplayName":"new bucket name if creating","targetDescription":"optional concise description","audience":"AGENT|PERSONAL"}]}`,
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create(
      {
        model: appConfig.chatModel,
        temperature: 0.1,
        max_tokens: 900,
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: appConfig.chatModelTimeoutMs },
    );

    const parsed = curatorSuggestionSchema.parse(
      parseJsonFromOutput(textFromContent(response.content)),
    );
    const model = String(response.model ?? appConfig.chatModel);
    const usage = normalizeAnthropicUsage(response.usage);
    const amountUsd = calculateAnthropicCostUsd(model, usage);

    if (amountUsd > 0) {
      await recordUsage({
        operation: "bucket_curator",
        amountUsd,
      });
    }

    const suggestions = normalizeCuratorSuggestions(parsed.suggestions, buckets);
    return {
      suggestions:
        suggestions.length > 0
          ? suggestions
          : instructionSuggestions.length > 0
            ? instructionSuggestions
            : heuristicSuggestions,
      usedModel: model,
    };
  } catch (error) {
    console.error("[bucket-curator] suggestion request failed:", error);
    return {
      suggestions:
        instructionSuggestions.length > 0
          ? instructionSuggestions
          : heuristicSuggestions,
      usedModel:
        instructionSuggestions.length > 0
          ? "instruction-curator"
          : "heuristic-curator",
    };
  }
}

export async function createRealBucket(input: {
  displayName: string;
  description?: string;
  audience: BucketAudience;
}) {
  const bucket = await ensureBucket({
    name: input.displayName,
    displayName: input.displayName,
    description: input.description,
  });

  await Promise.all([
    setBucketTier(bucket.id, "REAL"),
    setBucketAudience(bucket.id, input.audience),
  ]);

  return bucket;
}

export async function promoteBucket(input: {
  bucketId: string;
  audience: BucketAudience;
}) {
  const bucket = await prisma.bucket.findUnique({
    where: { id: input.bucketId },
  });
  if (!bucket) {
    throw new Error("Bucket not found");
  }

  await Promise.all([
    setBucketTier(bucket.id, "REAL"),
    setBucketAudience(bucket.id, input.audience),
  ]);

  return bucket;
}

export async function mergeBucketIntoTarget(input: {
  sourceBucketId: string;
  targetBucketId: string;
}) {
  if (input.sourceBucketId === input.targetBucketId) {
    throw new Error("Source and target buckets must be different");
  }

  const [sourceBucket, targetBucket] = await Promise.all([
    prisma.bucket.findUnique({
      where: { id: input.sourceBucketId },
      include: {
        _count: {
          select: {
            bookmarkAssignments: true,
          },
        },
        skills: {
          select: {
            id: true,
            kind: true,
          },
        },
      },
    }),
    prisma.bucket.findUnique({
      where: { id: input.targetBucketId },
      include: {
        skills: {
          select: {
            id: true,
            kind: true,
          },
        },
      },
    }),
  ]);

  if (!sourceBucket || !targetBucket) {
    throw new Error("One or more buckets do not exist");
  }

  const [targetTier, targetAudience] = await Promise.all([
    getBucketTier(targetBucket.id),
    getBucketAudience(targetBucket.id),
  ]);

  let targetMasterId =
    targetBucket.skills.find((skill) => skill.kind === SkillKind.MASTER)?.id ?? null;

  if (!targetMasterId && targetTier === "REAL" && targetAudience === "AGENT") {
    const ensuredMaster = await ensureMasterSkill(targetBucket);
    targetMasterId = ensuredMaster.id;
  }

  const sourceMicroSkillCount = sourceBucket.skills.filter(
    (skill) => skill.kind === SkillKind.MICRO,
  ).length;

  await prisma.$transaction(async (tx) => {
    const sourceSkills = await tx.skill.findMany({
      where: { bucketId: sourceBucket.id },
      select: { id: true, kind: true },
    });
    const sourceMaster = sourceSkills.find((skill) => skill.kind === SkillKind.MASTER);
    const sourceMicroSkills = sourceSkills.filter(
      (skill) => skill.kind === SkillKind.MICRO,
    );

    if (sourceMicroSkills.length > 0) {
      await tx.skill.updateMany({
        where: { id: { in: sourceMicroSkills.map((skill) => skill.id) } },
        data: {
          bucketId: targetBucket.id,
          parentSkillId: targetMasterId,
        },
      });
    }

    if (sourceMaster) {
      const sourceMasterReferences = await tx.skillReference.findMany({
        where: { skillId: sourceMaster.id },
        select: { bookmarkId: true, rationale: true },
      });

      if (targetMasterId) {
        for (const reference of sourceMasterReferences) {
          await tx.skillReference.upsert({
            where: {
              skillId_bookmarkId: {
                skillId: targetMasterId,
                bookmarkId: reference.bookmarkId,
              },
            },
            update: {
              rationale: reference.rationale,
            },
            create: {
              skillId: targetMasterId,
              bookmarkId: reference.bookmarkId,
              rationale: reference.rationale,
            },
          });
        }
      }

      await tx.skillReference.deleteMany({
        where: { skillId: sourceMaster.id },
      });

      await tx.bookmarkClassification.updateMany({
        where: { targetSkillId: sourceMaster.id },
        data: { targetSkillId: targetMasterId },
      });

      await tx.skill.delete({
        where: { id: sourceMaster.id },
      });
    }

    const sourceAssignments = await tx.bookmarkBucketAssignment.findMany({
      where: { bucketId: sourceBucket.id },
      select: { bookmarkId: true, isPrimary: true },
    });

    for (const assignment of sourceAssignments) {
      if (assignment.isPrimary) {
        await tx.bookmarkBucketAssignment.deleteMany({
          where: {
            bookmarkId: assignment.bookmarkId,
            isPrimary: true,
            NOT: { bucketId: targetBucket.id },
          },
        });
      }

      await tx.bookmarkBucketAssignment.upsert({
        where: {
          bookmarkId_bucketId: {
            bookmarkId: assignment.bookmarkId,
            bucketId: targetBucket.id,
          },
        },
        update: assignment.isPrimary ? { isPrimary: true } : {},
        create: {
          bookmarkId: assignment.bookmarkId,
          bucketId: targetBucket.id,
          isPrimary: assignment.isPrimary,
        },
      });
    }

    await tx.bookmarkBucketAssignment.deleteMany({
      where: { bucketId: sourceBucket.id },
    });

    await tx.bookmarkClassification.updateMany({
      where: { bucketId: sourceBucket.id },
      data: { bucketId: targetBucket.id },
    });

    await tx.setting.deleteMany({
      where: {
        key: {
          in: [
            `bucket_audience:${sourceBucket.id}`,
            `bucket_tier:${sourceBucket.id}`,
          ],
        },
      },
    });

    await tx.bucket.update({
      where: { id: targetBucket.id },
      data:
        targetTier === "REAL" && targetAudience === "AGENT"
          ? { dirtySince: new Date() }
          : {},
    });

    await tx.bucket.delete({
      where: { id: sourceBucket.id },
    });
  });

  return {
    sourceBucketName: sourceBucket.displayName,
    targetBucketName: targetBucket.displayName,
    movedBookmarks: sourceBucket._count.bookmarkAssignments,
    movedMicroSkills: sourceMicroSkillCount,
  };
}

export async function createRealBucketAndMerge(input: {
  displayName: string;
  description?: string;
  audience: BucketAudience;
  sourceBucketIds: string[];
}) {
  const bucket = await createRealBucket({
    displayName: input.displayName,
    description: input.description,
    audience: input.audience,
  });

  for (const sourceBucketId of input.sourceBucketIds) {
    if (sourceBucketId === bucket.id) {
      continue;
    }

    await mergeBucketIntoTarget({
      sourceBucketId,
      targetBucketId: bucket.id,
    });
  }

  return bucket;
}

export async function moveBookmarksToBucket(input: {
  bookmarkIds: string[];
  targetBucketId: string;
}) {
  const bookmarkIds = Array.from(new Set(input.bookmarkIds.filter(Boolean)));
  if (bookmarkIds.length === 0) {
    throw new Error("Select at least one bookmark");
  }

  const targetBucket = await prisma.bucket.findUnique({
    where: { id: input.targetBucketId },
    include: {
      skills: {
        select: {
          id: true,
          kind: true,
        },
      },
    },
  });

  if (!targetBucket) {
    throw new Error("Target bucket not found");
  }

  const [targetTier, targetAudience] = await Promise.all([
    getBucketTier(targetBucket.id),
    getBucketAudience(targetBucket.id),
  ]);

  let targetMasterId =
    targetBucket.skills.find((skill) => skill.kind === SkillKind.MASTER)?.id ?? null;

  if (!targetMasterId && targetTier === "REAL" && targetAudience === "AGENT") {
    const ensuredMaster = await ensureMasterSkill(targetBucket);
    targetMasterId = ensuredMaster.id;
  }

  return prisma.$transaction(async (tx) => {
    const bookmarks = await tx.bookmark.findMany({
      where: { id: { in: bookmarkIds } },
      include: {
        bucketAssignments: {
          where: { isPrimary: true },
          select: { bucketId: true },
        },
        classifications: {
          include: {
            targetSkill: {
              select: {
                id: true,
                kind: true,
                sourceBookmarkId: true,
              },
            },
          },
        },
      },
    });

    if (bookmarks.length !== bookmarkIds.length) {
      throw new Error("One or more bookmarks could not be found");
    }

    const dirtyBucketIds = new Set<string>();
    if (targetTier === "REAL" && targetAudience === "AGENT") {
      dirtyBucketIds.add(targetBucket.id);
    }

    let movedBookmarks = 0;
    let movedMicroSkills = 0;

    for (const bookmark of bookmarks) {
      const sourceBucketId = bookmark.bucketAssignments[0]?.bucketId ?? null;
      if (sourceBucketId === targetBucket.id) {
        continue;
      }

      movedBookmarks += 1;
      if (sourceBucketId) {
        dirtyBucketIds.add(sourceBucketId);
      }

      const existingClassification = bookmark.classifications;
      if (
        existingClassification?.targetSkill?.kind === SkillKind.MICRO &&
        existingClassification.targetSkill.sourceBookmarkId === bookmark.id
      ) {
        await tx.skill.update({
          where: { id: existingClassification.targetSkill.id },
          data: {
            bucketId: targetBucket.id,
            parentSkillId: targetMasterId,
          },
        });
        movedMicroSkills += 1;
      }

      await tx.skillReference.deleteMany({
        where: { bookmarkId: bookmark.id },
      });

      await tx.triageQueue.deleteMany({
        where: {
          tweetId: bookmark.id,
          status: TriageStatus.OPEN,
        },
      });

      if (existingClassification) {
        await tx.bookmarkClassification.delete({
          where: { bookmarkId: bookmark.id },
        });
      }

      await tx.bookmarkBucketAssignment.deleteMany({
        where: {
          bookmarkId: bookmark.id,
          isPrimary: true,
          NOT: { bucketId: targetBucket.id },
        },
      });

      await tx.bookmarkBucketAssignment.upsert({
        where: {
          bookmarkId_bucketId: {
            bookmarkId: bookmark.id,
            bucketId: targetBucket.id,
          },
        },
        update: {
          isPrimary: true,
        },
        create: {
          bookmarkId: bookmark.id,
          bucketId: targetBucket.id,
          isPrimary: true,
        },
      });
    }

    if (dirtyBucketIds.size > 0) {
      await tx.bucket.updateMany({
        where: {
          id: {
            in: Array.from(dirtyBucketIds),
          },
        },
        data: {
          dirtySince: new Date(),
        },
      });
    }

    return {
      movedBookmarks,
      movedMicroSkills,
      targetBucketName: targetBucket.displayName,
    };
  });
}
