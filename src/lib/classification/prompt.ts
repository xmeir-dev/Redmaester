import type { Bookmark, BookmarkEnrichment, Bucket, Skill } from "@prisma/client";
import type { BucketTier } from "@/lib/settings/service";

const MAX_ENRICHMENT_CHARS = 8_000;

function truncateContent(content: string | null, maxLength: number): string {
  if (!content) return "";
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength)}\n[truncated]`;
}

function buildEnrichmentBlock(enrichments: BookmarkEnrichment[]): string {
  return enrichments
    .filter((enrichment) => enrichment.content && enrichment.fetchMethod !== "failed")
    .map((enrichment) => {
      const title = enrichment.title ? ` — ${enrichment.title}` : "";
      return `### Linked URL: ${enrichment.url}${title}\n${truncateContent(enrichment.content, MAX_ENRICHMENT_CHARS)}`;
    })
    .join("\n\n");
}

type BucketSummary = Pick<Bucket, "name" | "displayName" | "description"> & {
  tier?: BucketTier;
};

export function buildBucketClassificationPrompt(
  bookmark: Bookmark,
  enrichments: BookmarkEnrichment[],
  existingBuckets: BucketSummary[]
): string {
  const enrichmentBlock = buildEnrichmentBlock(enrichments);
  const realBuckets = existingBuckets.filter((bucket) => bucket.tier === "REAL");
  const suggestedBuckets = existingBuckets.filter((bucket) => bucket.tier !== "REAL");
  const realBucketList = realBuckets.length > 0
    ? realBuckets
        .map(
          (bucket) =>
            `- ${bucket.name} (${bucket.displayName}): ${bucket.description}`,
        )
        .join("\n")
    : "(no real buckets yet)";
  const suggestedBucketList = suggestedBuckets.length > 0
    ? suggestedBuckets
        .map(
          (bucket) =>
            `- ${bucket.name} (${bucket.displayName}): ${bucket.description}`,
        )
        .join("\n")
    : "(no suggested buckets yet)";

  return `You are organizing bookmarked X posts into domain buckets and deciding whether each bookmark is a reference or a micro-skill.

## Goal

For this one bookmark, decide:
1. The most appropriate primary bucket.
2. Whether the bookmark is:
   - REFERENCE: useful supporting material for a bucket or an existing strategy.
   - MICRO_SKILL: a distinct reusable tactic, strategy, playbook, or workflow.
   - IGNORE: not useful enough for this knowledge system.

## Rules

- A bookmark may create a MICRO_SKILL from a single strong source.
- Prefer REFERENCE when the bookmark is informative but not directly reusable as a tactic.
- Prefer MICRO_SKILL when the bookmark contains a concrete, reusable strategy or operating pattern.
- Prefer an existing REAL bucket when it is semantically close, even if the wording is broader than the source bookmark.
- Only create or reuse a SUGGESTED bucket when no REAL bucket is a good fit.
- If a new bucket is needed, invent a short kebab-case name.
- Keep bucket names broad. Keep micro-skill names more specific.
- The bucket should be the bookmark's primary home in the system.

## Real Buckets

${realBucketList}

## Suggested Buckets

${suggestedBucketList}

## Bookmark

Author: @${bookmark.authorHandle}${bookmark.authorName ? ` (${bookmark.authorName})` : ""}
Text: ${bookmark.text}
URL: ${bookmark.url}
Bookmarked: ${bookmark.bookmarkedAt.toISOString()}

${enrichmentBlock ? `## Linked Content\n\n${enrichmentBlock}` : ""}

## Response Format

Return JSON only:
{
  "bucketName": "<kebab-case bucket name>",
  "bucketDisplayName": "<human bucket name>",
  "bucketDescription": "<one sentence bucket description>",
  "roleType": "REFERENCE" | "MICRO_SKILL" | "IGNORE",
  "microSkillName": "<optional kebab-case micro skill name when roleType is MICRO_SKILL>",
  "confidence": <number 0-1>,
  "rationale": "<one sentence>"
}`;
}

export function buildMicroSkillPrompt(input: {
  bookmark: Bookmark;
  enrichments: BookmarkEnrichment[];
  bucket: Bucket;
  existingSkill?: Pick<Skill, "name" | "content" | "description">;
  skillName: string;
}): string {
  const enrichmentBlock = buildEnrichmentBlock(input.enrichments);
  const existingSkillBlock = input.existingSkill
    ? `## Existing Micro-Skill\n\nName: ${input.existingSkill.name}\n\n${truncateContent(input.existingSkill.content, MAX_ENRICHMENT_CHARS)}`
    : "";

  return `Create or update a reusable micro-skill for the ${input.bucket.displayName} bucket.

## Intent

- A micro-skill is a narrow, reusable tactic or strategy.
- Keep it specific and operational.
- Preserve the strongest actionable ideas from the source bookmark.
- If an existing micro-skill is provided, improve it without making it overly broad.

## Bucket Context

Bucket: ${input.bucket.displayName}
Bucket description: ${input.bucket.description}
Target micro-skill name: ${input.skillName}

## Source Bookmark

Author: @${input.bookmark.authorHandle}
Text: ${input.bookmark.text}
URL: ${input.bookmark.url}

${enrichmentBlock ? `## Linked Content\n\n${enrichmentBlock}` : ""}

${existingSkillBlock}

## Output

Return ONLY the SKILL.md content. Start with a # heading that names the micro-skill.`;
}

type ReferenceRecord = {
  tweetId: string;
  authorHandle: string;
  text: string;
  url: string;
  rationale?: string | null;
};

export function buildMasterSkillPrompt(input: {
  bucket: Bucket;
  masterSkill: Pick<Skill, "name" | "content" | "description">;
  microSkills: Array<Pick<Skill, "name" | "description" | "content">>;
  references: ReferenceRecord[];
}): string {
  const microSkillBlock = input.microSkills.length > 0
    ? input.microSkills
      .map((skill) => `### ${skill.name}\n${skill.description}\n\n${truncateContent(skill.content, 2_400)}`)
      .join("\n\n")
    : "(no micro-skills yet)";

  const referenceBlock = input.references.length > 0
    ? input.references
      .map((reference, index) =>
        `${index + 1}. tweet_id=${reference.tweetId} @${reference.authorHandle}\ntext=${reference.text}\nurl=${reference.url}${reference.rationale ? `\nrationale=${reference.rationale}` : ""}`
      )
      .join("\n\n")
    : "(no new reference bookmarks)";

  return `Update the living master skill for the ${input.bucket.displayName} bucket.

## Goal

- Produce one durable SKILL.md-style master skill for this bucket.
- Synthesize the bucket's recurring ideas, frameworks, and strategy patterns.
- Integrate useful reference material without turning the master skill into a dump of notes.
- Use the micro-skills as the sharper tactical sub-components inside the bucket.

## Bucket

Name: ${input.bucket.displayName}
Description: ${input.bucket.description}

## Existing Master Skill

${truncateContent(input.masterSkill.content, 6_000)}

## Current Micro-Skills

${microSkillBlock}

## Recent Reference Bookmarks

${referenceBlock}

## Output

Return ONLY the updated SKILL.md content for the master skill. Start with a # heading for ${input.bucket.displayName}.`;
}
