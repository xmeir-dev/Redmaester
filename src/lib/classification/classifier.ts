import Anthropic from "@anthropic-ai/sdk";
import type { Bookmark, BookmarkEnrichment, Bucket, Skill } from "@prisma/client";
import type { BucketTier } from "@/lib/settings/service";
import { z } from "zod";

import { toDisplayName, toKebabCase } from "@/lib/buckets/service";
import { calculateAnthropicCostUsd, normalizeAnthropicUsage } from "@/lib/ai/pricing";
import { appConfig } from "@/lib/domain/config";
import type { ModelUsageSnapshot } from "@/lib/domain/types";
import {
  buildBucketClassificationPrompt,
  buildMasterSkillPrompt,
  buildMicroSkillPrompt
} from "@/lib/classification/prompt";

export type BucketedClassificationOutput = {
  bucketName: string;
  bucketDisplayName: string;
  bucketDescription: string;
  roleType: "REFERENCE" | "MICRO_SKILL" | "IGNORE";
  confidence: number;
  rationale: string;
  microSkillName?: string;
  fallback: boolean;
  usage?: ModelUsageSnapshot;
};

type BucketSummary = Pick<Bucket, "id" | "name" | "displayName" | "description"> & {
  tier?: BucketTier;
};

const classificationSchema = z.object({
  bucketName: z.string().min(1),
  bucketDisplayName: z.string().min(1).optional(),
  bucketDescription: z.string().min(1).optional(),
  roleType: z.enum(["REFERENCE", "MICRO_SKILL", "IGNORE"]),
  microSkillName: z.string().nullable().optional().transform((value) => value ?? undefined),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

const BUCKET_KEYWORDS: Array<{
  bucketName: string;
  bucketDescription: string;
  tokens: string[];
}> = [
  {
    bucketName: "polymarket",
    bucketDescription: "Trading, market structure, prediction markets, and Polymarket strategies.",
    tokens: ["polymarket", "prediction market", "orderbook", "arb", "arbing", "market making"],
  },
  {
    bucketName: "ux-ui",
    bucketDescription: "UX research, interface design, onboarding, copy, and product experience patterns.",
    tokens: ["ux", "ui", "figma", "interface", "onboarding", "design", "user experience", "prototype"],
  },
  {
    bucketName: "growth",
    bucketDescription: "Growth loops, acquisition, retention, messaging, and distribution ideas.",
    tokens: ["growth", "acquisition", "retention", "distribution", "seo", "conversion", "messaging"],
  },
  {
    bucketName: "agents",
    bucketDescription: "AI agents, prompting, automation, system prompts, and skill design.",
    tokens: ["agent", "agents", "prompt", "skill", "skill.md", "claude", "automation", "system prompt"],
  },
  {
    bucketName: "product",
    bucketDescription: "Product strategy, roadmap, pricing, positioning, and product-management ideas.",
    tokens: ["product", "pricing", "positioning", "roadmap", "feature", "launch", "pmf"],
  }
];

const MICRO_SKILL_HINTS = [
  "strategy",
  "playbook",
  "workflow",
  "framework",
  "checklist",
  "how to",
  "system prompt",
  "template",
  "tactic",
  "setup",
  "steps",
];

const IGNORE_HINTS = [
  "recipe",
  "football",
  "nba",
  "weather",
  "vacation",
  "movie review",
];

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const value = block as { type?: string; text?: string };
      return value.type === "text" ? (value.text ?? "") : "";
    })
    .join("\n")
    .trim();
}

function parseJsonFromOutput(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(candidate);
}

function normalizeUsage(model: string, response: Awaited<ReturnType<Anthropic["messages"]["create"]>>): ModelUsageSnapshot {
  const usage = normalizeAnthropicUsage("usage" in response ? response.usage : undefined);
  return {
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    costUsd: calculateAnthropicCostUsd(model, usage)
  };
}

function buildFallbackContent(title: string, body: string, sections: string[]): string {
  return [`# ${title}`, "", ...sections.flatMap((section) => [section, ""]), body.trim()].join("\n").trim();
}

function fallbackBucketClassification(
  bookmark: Bookmark,
  enrichments: BookmarkEnrichment[],
  existingBuckets: BucketSummary[]
): BucketedClassificationOutput {
  const text = [bookmark.text, ...enrichments.map((enrichment) => enrichment.content ?? "")]
    .join(" ")
    .toLowerCase();

  const matchedKeywordBucket = BUCKET_KEYWORDS.find((bucket) =>
    bucket.tokens.some((token) => text.includes(token))
  );

  const prioritizedExistingBuckets = [...existingBuckets].sort((a, b) => {
    if ((a.tier ?? "SUGGESTED") === (b.tier ?? "SUGGESTED")) {
      return 0;
    }
    return (a.tier ?? "SUGGESTED") === "REAL" ? -1 : 1;
  });

  const matchedExistingBucket = prioritizedExistingBuckets.find((bucket) =>
    text.includes(bucket.name) || text.includes(bucket.displayName.toLowerCase())
  );

  const bucketName = matchedExistingBucket?.name ?? matchedKeywordBucket?.bucketName ?? "general";
  const bucketDisplayName = matchedExistingBucket?.displayName ?? toDisplayName(bucketName);
  const bucketDescription =
    matchedExistingBucket?.description ??
    matchedKeywordBucket?.bucketDescription ??
    `Knowledge bucket for ${bucketDisplayName}.`;

  const roleType = IGNORE_HINTS.some((token) => text.includes(token))
    ? "IGNORE"
    : MICRO_SKILL_HINTS.some((token) => text.includes(token))
      ? "MICRO_SKILL"
      : "REFERENCE";

  const microSkillName = roleType === "MICRO_SKILL"
    ? toKebabCase(`${bucketName}-${bookmark.text.split(/\s+/).slice(0, 6).join(" ")}`)
    : undefined;

  return {
    bucketName,
    bucketDisplayName,
    bucketDescription,
    roleType,
    confidence: roleType === "IGNORE" ? 0.55 : 0.62,
    rationale: "Keyword fallback classification.",
    microSkillName,
    fallback: true
  };
}

async function callJsonModel<T>(
  model: string,
  prompt: string,
  timeoutMs: number,
  schema: z.ZodSchema<T>
): Promise<{ parsed: T; usage: ModelUsageSnapshot } | null> {
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await Promise.race([
      client.messages.create(
        {
          model,
          temperature: 0.1,
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }]
        },
        { timeout: timeoutMs }
      ),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(new Error("model_timeout"));
        }, timeoutMs);
      })
    ]);

    const resolvedModel = String(response.model ?? model);
    const parsed = schema.parse(parseJsonFromOutput(textFromContent(response.content)));

    return {
      parsed,
      usage: normalizeUsage(resolvedModel, response)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[classifier] JSON model call failed: ${message}`);
    return null;
  }
}

async function callTextModel(
  model: string,
  prompt: string,
  timeoutMs: number,
  maxTokens: number
): Promise<{ content: string; usage: ModelUsageSnapshot } | null> {
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await Promise.race([
      client.messages.create(
        {
          model,
          temperature: 0.2,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }]
        },
        { timeout: timeoutMs }
      ),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(new Error("model_timeout"));
        }, timeoutMs);
      })
    ]);

    const content = textFromContent(response.content).trim();
    if (!content) {
      return null;
    }

    return {
      content,
      usage: normalizeUsage(String(response.model ?? model), response)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[classifier] Text model call failed: ${message}`);
    return null;
  }
}

export async function classifyBookmark(input: {
  bookmark: Bookmark;
  enrichments: BookmarkEnrichment[];
  existingBuckets: BucketSummary[];
}): Promise<BucketedClassificationOutput> {
  const { bookmark, enrichments, existingBuckets } = input;

  if (!process.env.ANTHROPIC_API_KEY) {
    return fallbackBucketClassification(bookmark, enrichments, existingBuckets);
  }

  const prompt = buildBucketClassificationPrompt(bookmark, enrichments, existingBuckets);
  let result = await callJsonModel(
    appConfig.bookmarkClassificationModel,
    prompt,
    appConfig.routingModelTimeoutMs,
    classificationSchema
  );

  if (!result) {
    result = await callJsonModel(
      appConfig.bookmarkClassificationModel,
      prompt,
      appConfig.routingModelTimeoutMs * 2,
      classificationSchema
    );
  }

  if (!result) {
    return fallbackBucketClassification(bookmark, enrichments, existingBuckets);
  }

  const bucketName = toKebabCase(result.parsed.bucketName);
  const roleType = result.parsed.roleType;
  const microSkillName = roleType === "MICRO_SKILL" && result.parsed.microSkillName
    ? toKebabCase(result.parsed.microSkillName)
    : undefined;

  return {
    bucketName,
    bucketDisplayName: result.parsed.bucketDisplayName?.trim() || toDisplayName(bucketName),
    bucketDescription:
      result.parsed.bucketDescription?.trim() || `Knowledge bucket for ${toDisplayName(bucketName)}.`,
    roleType,
    confidence: result.parsed.confidence,
    rationale: result.parsed.rationale,
    microSkillName,
    fallback: false,
    usage: result.usage
  };
}

export async function generateMicroSkillContent(input: {
  bookmark: Bookmark;
  enrichments: BookmarkEnrichment[];
  bucket: Bucket;
  skillName: string;
  existingSkill?: Pick<Skill, "name" | "content" | "description">;
}): Promise<{ content: string; usage?: ModelUsageSnapshot } | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    const body = [
      `You are the ${toDisplayName(input.skillName)} micro-skill inside the ${input.bucket.displayName} bucket.`,
      "",
      "## Source Tactic",
      input.bookmark.text || "Derived from imported bookmark knowledge.",
      "",
      "## Usage",
      "Apply the tactic described by the source material, adapt it to the current task, and preserve any concrete operating details."
    ].join("\n");

    return {
      content: buildFallbackContent(toDisplayName(input.skillName), body, []),
    };
  }

  const prompt = buildMicroSkillPrompt(input);
  const result = await callTextModel(
    appConfig.microSkillModel,
    prompt,
    appConfig.routingModelTimeoutMs * 3,
    4_000
  );

  if (!result || result.content.length < 50) {
    return null;
  }

  return result;
}

export async function synthesizeMasterSkill(input: {
  bucket: Bucket;
  masterSkill: Pick<Skill, "name" | "content" | "description">;
  microSkills: Array<Pick<Skill, "name" | "description" | "content">>;
  references: Array<{
    tweetId: string;
    authorHandle: string;
    text: string;
    url: string;
    rationale?: string | null;
  }>;
}): Promise<{ content: string; usage?: ModelUsageSnapshot } | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    const microList = input.microSkills.length > 0
      ? input.microSkills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")
      : "- No micro-skills yet";
    const referenceList = input.references.length > 0
      ? input.references.slice(0, 8).map((reference) => `- @${reference.authorHandle}: ${reference.text}`).join("\n")
      : "- No recent references yet";

    return {
      content: [
        `# ${input.bucket.displayName}`,
        "",
        input.bucket.description,
        "",
        "## Micro-Skills",
        microList,
        "",
        "## Recent References",
        referenceList,
      ].join("\n")
    };
  }

  const prompt = buildMasterSkillPrompt(input);
  const result = await callTextModel(
    appConfig.masterSkillModel,
    prompt,
    appConfig.routingModelTimeoutMs * 3,
    4_000
  );

  if (!result || result.content.length < 50) {
    return null;
  }

  return result;
}
