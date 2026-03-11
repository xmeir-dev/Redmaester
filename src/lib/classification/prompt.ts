import type { Bookmark, BookmarkEnrichment, Skill } from "@prisma/client";

const MAX_ENRICHMENT_CHARS = 8000;

function truncateContent(content: string | null, maxLength: number): string {
  if (!content) return "";
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + "\n[truncated]";
}

type SkillSummary = Pick<Skill, "name" | "description">;

export function buildClassificationPrompt(
  bookmark: Bookmark,
  enrichments: BookmarkEnrichment[],
  existingSkills: SkillSummary[]
): string {
  const enrichmentBlock = enrichments
    .filter((e) => e.content && e.fetchMethod !== "failed")
    .map(
      (e) =>
        `### Linked URL: ${e.url}${e.title ? ` — ${e.title}` : ""}\n${truncateContent(e.content, MAX_ENRICHMENT_CHARS)}`
    )
    .join("\n\n");

  const skillList =
    existingSkills.length > 0
      ? existingSkills.map((s) => `- **${s.name}**: ${s.description}`).join("\n")
      : "(no skills registered yet)";

  return `You are a bookmark classifier. Analyze the following bookmarked tweet and its linked content to determine its classification.

## Domain Context

This system collects bookmarks about AI agent skills, Claude Code configurations, system prompts, agent instruction files, and related tooling. The user is actively building a collection of agent skills. Err on the side of capturing relevant content rather than discarding it — a false positive that lands in triage is far less costly than missing a genuine skill or reference.

## Classification Types

1. **skill** — The bookmark contains prescriptive agent instructions: a system prompt, an agent configuration file (SKILL.md), or a detailed "how an agent should behave" specification. It is NOT an article ABOUT agents or AI — it must contain actual instructions that could be directly used as an agent's operating manual.

2. **reference** — The bookmark contains information relevant to one of the existing skills listed below, OR it contains substantial content about AI agents, skills, prompting, or Claude that would be valuable reference material. It could be useful background knowledge, a relevant article, a case study, or data that an existing skill's agent should know about.

3. **unrelated** — The bookmark does not fit either category above. It is clearly off-topic (personal content, unrelated tech, news, etc.).

## Decision Rules

- When torn between skill and reference → prefer **skill** if content contains prescriptive instructions (directives, constraints, behavioral rules)
- When torn between skill and unrelated → prefer **skill** if content contains any agent instruction patterns
- When torn between reference and unrelated → prefer **reference** if content is clearly about AI agents, skills, prompting, or Claude
- "reference" SHOULD match an existing skill name if one fits — but if no existing skill matches, you may suggest a new skill name using "suggestedSkillName"
- A blog post ABOUT prompt engineering is a **reference** (not unrelated), even if no existing skill matches
- A system prompt or agent config IS a skill

## Existing Skills

${skillList}

## Bookmark

**Author:** @${bookmark.authorHandle}${bookmark.authorName ? ` (${bookmark.authorName})` : ""}
**Text:** ${bookmark.text}
**URL:** ${bookmark.url}
**Bookmarked:** ${bookmark.bookmarkedAt.toISOString()}

${enrichmentBlock ? `## Linked Content\n\n${enrichmentBlock}` : ""}

## Response Format

Return a JSON object (no markdown fencing):
{
  "type": "skill" | "reference" | "unrelated",
  "confidence": <number 0-1>,
  "rationale": "<one sentence explaining the classification>",
  "skillName": "<kebab-case name if type=skill, e.g. 'code-reviewer'>",
  "matchedSkillName": "<exact name from existing skills list if type=reference>",
  "suggestedSkillName": "<kebab-case name if type=reference and no existing skill matches, e.g. 'prompt-engineering'>"
}`;
}

export function buildSkillExtractionPrompt(
  bookmark: Bookmark,
  enrichments: BookmarkEnrichment[]
): string {
  const enrichmentBlock = enrichments
    .filter((e) => e.content && e.fetchMethod !== "failed")
    .map(
      (e) =>
        `### Source: ${e.url}${e.title ? ` — ${e.title}` : ""}\n${truncateContent(e.content, MAX_ENRICHMENT_CHARS)}`
    )
    .join("\n\n");

  return `Extract the agent instruction content from the following bookmark into a clean SKILL.md format.

The output should be a complete, self-contained agent instruction file that could be saved as SKILL.md. Include:
- A clear role/identity section
- Key responsibilities and behaviors
- Any constraints or guidelines
- Knowledge domains the agent should focus on

If the content is a system prompt, preserve its intent but format it cleanly.
If the content describes an agent's behavior, convert it into directive instructions.

## Source Bookmark

**Author:** @${bookmark.authorHandle}
**Text:** ${bookmark.text}

${enrichmentBlock ? `## Linked Content\n\n${enrichmentBlock}` : ""}

## Output

Return ONLY the SKILL.md content, nothing else. Start with a # heading for the skill name.`;
}
