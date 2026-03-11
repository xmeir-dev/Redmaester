import Anthropic from "@anthropic-ai/sdk";
import type { Bookmark, BookmarkEnrichment, Skill } from "@prisma/client";
import { z } from "zod";

import { calculateAnthropicCostUsd, normalizeAnthropicUsage } from "@/lib/ai/pricing";
import { appConfig } from "@/lib/domain/config";
import type { ModelUsageSnapshot } from "@/lib/domain/types";
import {
  buildClassificationPrompt,
  buildSkillExtractionPrompt
} from "@/lib/classification/prompt";

export type ClassificationOutput = {
  type: "skill" | "reference" | "unrelated";
  confidence: number;
  rationale: string;
  skillName?: string;
  suggestedSkillName?: string;
  matchedSkillName?: string;
  matchedSkillId?: string;
  extractedSkillContent?: string;
  fallback: boolean;
  usage?: ModelUsageSnapshot;
};

type SkillSummary = Pick<Skill, "id" | "name" | "description">;

const classificationSchema = z.object({
  type: z.enum(["skill", "reference", "unrelated"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  skillName: z.string().nullable().optional().transform((v) => v ?? undefined),
  matchedSkillName: z.string().nullable().optional().transform((v) => v ?? undefined),
  suggestedSkillName: z.string().nullable().optional().transform((v) => v ?? undefined)
});

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const b = block as { type?: string; text?: string };
      return b.type === "text" ? (b.text ?? "") : "";
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

// Keyword heuristic patterns for fallback classification
const SKILL_KEYWORDS = [
  "system prompt",
  "you are a",
  "you are an",
  "skill.md",
  "your role is",
  "act as a",
  "act as an",
  "your task is",
  "## instructions",
  "## role",
  "## identity",
  "claude skill",
  "agent configuration",
  "custom instruction",
  "claude code skill",
  "mcp server",
  "## constraints",
  "## capabilities",
  "you must always",
  "respond as"
];

const REFERENCE_KEYWORDS = [
  "prompt engineering",
  "building skills",
  "agent design",
  "guide to",
  "agentic",
  "best practices",
  "how to build",
  "claude code",
  "system prompt",
  "agent instruction",
  "skill configuration"
];

function fallbackClassify(
  bookmark: Bookmark,
  enrichments: BookmarkEnrichment[],
  existingSkills: SkillSummary[]
): ClassificationOutput {
  const allText = [
    bookmark.text,
    ...enrichments
      .filter((e) => e.content)
      .map((e) => e.content!)
  ]
    .join(" ")
    .toLowerCase();

  // Check for skill patterns
  const skillHits = SKILL_KEYWORDS.filter((kw) => allText.includes(kw));
  if (skillHits.length >= 2) {
    return {
      type: "skill",
      confidence: Math.min(0.7, 0.4 + skillHits.length * 0.1),
      rationale: `Keyword heuristic: matched ${skillHits.length} skill patterns (${skillHits.slice(0, 3).join(", ")})`,
      fallback: true
    };
  }

  // Check for reference to existing skills
  for (const skill of existingSkills) {
    if (skill.id.startsWith("__seed__")) continue; // Skip seed skills for keyword matching
    const nameTokens = skill.name.split("-");
    const hits = nameTokens.filter((t) => t.length >= 3 && allText.includes(t));
    if (hits.length >= 2 || (nameTokens.length === 1 && hits.length === 1 && hits[0].length >= 5)) {
      return {
        type: "reference",
        confidence: 0.5,
        rationale: `Keyword heuristic: content mentions terms related to skill "${skill.name}"`,
        matchedSkillName: skill.name,
        matchedSkillId: skill.id,
        fallback: true
      };
    }
  }

  // Check for reference keywords — domain-relevant content about skills/agents
  const refHits = REFERENCE_KEYWORDS.filter((kw) => allText.includes(kw));
  if (refHits.length >= 2) {
    return {
      type: "skill",
      confidence: 0.50,
      rationale: `Keyword heuristic: matched ${refHits.length} reference patterns (${refHits.slice(0, 3).join(", ")}) — likely domain-relevant content`,
      fallback: true
    };
  }

  return {
    type: "unrelated",
    confidence: 0.8,
    rationale: "No skill or reference patterns detected (keyword fallback)",
    fallback: true
  };
}

async function callClassificationAPI(
  client: Anthropic,
  prompt: string,
  timeoutMs: number,
  existingSkills: SkillSummary[]
): Promise<{ parsed: z.infer<typeof classificationSchema>; model: string; usage: ModelUsageSnapshot } | null> {
  try {
    const response = await Promise.race([
      client.messages.create(
        {
          model: appConfig.routingModel,
          temperature: 0.1,
          max_tokens: 500,
          messages: [{ role: "user", content: prompt }]
        },
        { timeout: timeoutMs }
      ),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(new Error("classification_timeout"));
        }, timeoutMs);
      })
    ]);

    const text = textFromContent(response.content);
    const parsed = classificationSchema.parse(parseJsonFromOutput(text));
    const model = String(response.model ?? appConfig.routingModel);
    const rawUsage = normalizeAnthropicUsage(response.usage);

    return {
      parsed,
      model,
      usage: {
        model,
        inputTokens: rawUsage.inputTokens,
        outputTokens: rawUsage.outputTokens,
        cacheCreationInputTokens: rawUsage.cacheCreationInputTokens,
        cacheReadInputTokens: rawUsage.cacheReadInputTokens,
        costUsd: calculateAnthropicCostUsd(model, rawUsage)
      }
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown error";
    console.error(`[classifier] API call failed: ${msg}`);
    return null;
  }
}

export async function classifyBookmark(input: {
  bookmark: Bookmark;
  enrichments: BookmarkEnrichment[];
  existingSkills: SkillSummary[];
}): Promise<ClassificationOutput> {
  const { bookmark, enrichments, existingSkills } = input;

  if (!process.env.ANTHROPIC_API_KEY) {
    return fallbackClassify(bookmark, enrichments, existingSkills);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = buildClassificationPrompt(bookmark, enrichments, existingSkills);

  // First attempt
  let result = await callClassificationAPI(client, prompt, appConfig.routingModelTimeoutMs, existingSkills);

  // Retry once with 2x timeout on failure
  if (!result) {
    console.warn(`[classifier] Retrying classification for bookmark ${bookmark.id} with 2x timeout`);
    result = await callClassificationAPI(client, prompt, appConfig.routingModelTimeoutMs * 2, existingSkills);
  }

  if (!result) {
    console.warn(`[classifier] Both attempts failed for bookmark ${bookmark.id} — falling back to keyword heuristic`);
    return fallbackClassify(bookmark, enrichments, existingSkills);
  }

  const { parsed, usage } = result;

  // Post-validation: reference must match an existing skill
  let type = parsed.type;
  let matchedSkillName = parsed.matchedSkillName;
  let matchedSkillId: string | undefined;
  let suggestedSkillName = parsed.suggestedSkillName;

  if (type === "reference") {
    const matched = existingSkills.find((s) => s.name === matchedSkillName);
    if (!matched) {
      // Cold-start fix: if no existing skill matches but a suggestedSkillName is provided,
      // promote to skill with capped confidence so it lands in triage
      if (suggestedSkillName) {
        type = "skill";
        matchedSkillName = undefined;
        return {
          type,
          confidence: Math.min(parsed.confidence, 0.60),
          rationale: parsed.rationale,
          skillName: suggestedSkillName,
          suggestedSkillName,
          fallback: false,
          usage
        };
      }
      type = "unrelated";
      matchedSkillName = undefined;
    } else {
      matchedSkillId = matched.id;
    }
  }

  // Post-validation: skill with same name exists → treat as reference
  if (type === "skill" && parsed.skillName) {
    const existing = existingSkills.find((s) => s.name === parsed.skillName);
    if (existing) {
      type = "reference";
      matchedSkillName = existing.name;
      matchedSkillId = existing.id;
    }
  }

  return {
    type,
    confidence: parsed.confidence,
    rationale: parsed.rationale,
    skillName: type === "skill" ? parsed.skillName : undefined,
    suggestedSkillName,
    matchedSkillName,
    matchedSkillId,
    fallback: false,
    usage
  };
}

export async function extractSkillContent(
  bookmark: Bookmark,
  enrichments: BookmarkEnrichment[]
): Promise<{ content: string; usage?: ModelUsageSnapshot } | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = buildSkillExtractionPrompt(bookmark, enrichments);

    const response = await Promise.race([
      client.messages.create(
        {
          model: appConfig.routingModel,
          temperature: 0.2,
          max_tokens: 4000,
          messages: [{ role: "user", content: prompt }]
        },
        { timeout: appConfig.routingModelTimeoutMs * 3 } // More time for extraction
      ),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          reject(new Error("extraction_timeout"));
        }, appConfig.routingModelTimeoutMs * 3);
      })
    ]);

    const text = textFromContent(response.content);
    if (!text || text.length < 50) {
      return null;
    }

    const model = String(response.model ?? appConfig.routingModel);
    const rawUsage = normalizeAnthropicUsage(response.usage);

    return {
      content: text,
      usage: {
        model,
        inputTokens: rawUsage.inputTokens,
        outputTokens: rawUsage.outputTokens,
        cacheCreationInputTokens: rawUsage.cacheCreationInputTokens,
        cacheReadInputTokens: rawUsage.cacheReadInputTokens,
        costUsd: calculateAnthropicCostUsd(model, rawUsage)
      }
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown error";
    console.error(`[classifier] Skill extraction failed for bookmark ${bookmark.id}: ${msg}`);
    return null;
  }
}
