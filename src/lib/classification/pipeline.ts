import { prisma } from "@/lib/db/prisma";
import { canSpend, getCurrentMonthSpend, recordUsage } from "@/lib/domain/budget";
import { appConfig } from "@/lib/domain/config";
import { classifyBookmark, extractSkillContent } from "@/lib/classification/classifier";
import { handleClassification } from "@/lib/classification/action-handler";
import { enrichBookmark } from "@/lib/enrichment/enrichment-service";

export type PipelineResult = {
  processed: number;
  enriched: number;
  classified: number;
  skillsCreated: number;
  referencesAttached: number;
  triaged: number;
  blocked?: boolean;
  pendingCount?: number;
  estimatedCost?: number;
  budgetRemaining?: number;
  enrichmentWarning?: string;
  log: string[];
};

const BATCH_LIMIT = 10;
const MAX_WALL_CLOCK_MS = 4 * 60 * 1000; // 4 minutes

// Seed skill hints for cold-start — gives the classifier reference targets
// when the DB has zero real skills
const SEED_SKILLS = [
  {
    id: "__seed__agent-skills",
    name: "agent-skills",
    description: "General agent skill configurations, system prompts, and SKILL.md files"
  },
  {
    id: "__seed__claude-code",
    name: "claude-code",
    description: "Claude Code configurations, custom instructions, and slash commands"
  },
  {
    id: "__seed__prompt-engineering",
    name: "prompt-engineering",
    description: "Prompt engineering techniques, patterns, and best practices for AI agents"
  }
];

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

  // Determine pending bookmarks
  const pendingWhere = reclassify
    ? {} // All bookmarks
    : {
        OR: [
          { classifications: { is: null } },
          { classifications: { fallback: true } }
        ]
      };

  const pendingCount = await prisma.bookmark.count({ where: pendingWhere });
  const log: string[] = [];
  function emit(msg: string) {
    log.push(msg);
    onLog?.(msg);
  }

  if (pendingCount === 0) {
    emit("No bookmarks to classify");
    return {
      processed: 0,
      enriched: 0,
      classified: 0,
      skillsCreated: 0,
      referencesAttached: 0,
      triaged: 0,
      log
    };
  }

  emit(`${pendingCount} bookmarks pending classification`);

  // Pre-flight cost check
  if (!force) {
    const estimatedCost = pendingCount * appConfig.estimatedClassificationCostUsd;
    const monthSpend = await getCurrentMonthSpend();
    const budgetRemaining = appConfig.monthlyBudgetUsd - monthSpend;

    if (estimatedCost > budgetRemaining) {
      emit(`Budget exceeded — need $${estimatedCost.toFixed(2)}, have $${budgetRemaining.toFixed(2)}`);
      return {
        processed: 0,
        enriched: 0,
        classified: 0,
        skillsCreated: 0,
        referencesAttached: 0,
        triaged: 0,
        blocked: true,
        pendingCount,
        estimatedCost,
        budgetRemaining,
        log
      };
    }
  }

  let totalProcessed = 0;
  let totalEnriched = 0;
  let totalClassified = 0;
  let totalSkillsCreated = 0;
  let totalReferencesAttached = 0;
  let totalTriaged = 0;
  let totalFailedEnrichments = 0;
  let totalEnrichmentCount = 0;

  // Load existing skills (refreshed after each skill creation)
  let existingSkills = await prisma.skill.findMany({
    select: { id: true, name: true, description: true }
  });

  // Cold-start: inject seed skill hints if DB has zero real skills
  if (existingSkills.length === 0) {
    console.log("[pipeline] No existing skills found — injecting seed skill hints for cold-start");
    existingSkills = SEED_SKILLS;
  }

  console.log(`[pipeline] Starting classification: ${pendingCount} pending, ${existingSkills.length} skills (${existingSkills.some(s => s.id.startsWith("__seed__")) ? "seed" : "real"})`);

  // Continuation loop
  let continueLoop = true;
  while (continueLoop) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= MAX_WALL_CLOCK_MS) break;

    // Fetch batch
    const bookmarks = await prisma.bookmark.findMany({
      where: pendingWhere,
      orderBy: { bookmarkedAt: "desc" },
      take: BATCH_LIMIT
    });

    if (bookmarks.length === 0) break;

    // Emit queue status for all bookmarks in this batch
    for (const bm of bookmarks) {
      onBookmarkStep?.(bm.id, "queue");
    }

    let batchProcessed = 0;

    for (const bookmark of bookmarks) {
      // Budget check per bookmark
      const withinBudget = await canSpend(appConfig.estimatedClassificationCostUsd);
      if (!withinBudget && !force) {
        emit("Budget limit reached — stopping");
        continueLoop = false;
        break;
      }

      // Delete existing classification if reclassifying or retrying a fallback
      const existingClassification = await prisma.bookmarkClassification.findUnique({
        where: { bookmarkId: bookmark.id }
      });
      if (existingClassification) {
        if (reclassify || existingClassification.fallback) {
          await prisma.bookmarkClassification.delete({
            where: { bookmarkId: bookmark.id }
          });
          await prisma.skillReference.deleteMany({
            where: { bookmarkId: bookmark.id }
          });
        } else {
          // Already classified (not fallback) — skip
          continue;
        }
      }

      const shortAuthor = `@${bookmark.authorHandle}`;
      const snippet = bookmark.text.slice(0, 60).replace(/\n/g, " ");
      const label = `${shortAuthor}: "${snippet}${bookmark.text.length > 60 ? "…" : ""}"`;

      try {
        // Step 1: Enrich
        onBookmarkStep?.(bookmark.id, "enriching");
        emit(`Enriching ${label}`);
        const enrichResult = await enrichBookmark(bookmark);
        totalEnriched += enrichResult.successCount;
        totalEnrichmentCount += enrichResult.totalUrls;
        totalFailedEnrichments += enrichResult.totalUrls - enrichResult.successCount;

        for (const msg of enrichResult.log) {
          emit(`  ${msg}`);
        }

        console.log(`[pipeline] Enriched bookmark ${bookmark.id}: ${enrichResult.successCount}/${enrichResult.totalUrls} URLs fetched`);

        // Log thin enrichment but still proceed to classification —
        // the classifier has the full tweet text as context
        const hadUrls = enrichResult.totalUrls > 0;
        const maxEnrichmentLength = Math.max(0, ...enrichResult.enrichments.map(e => e.contentLength));
        if (hadUrls && maxEnrichmentLength < 200) {
          emit(`  Enrichment thin (${maxEnrichmentLength} chars) — classifying with tweet text`);
        }

        // Step 2: Classify
        onBookmarkStep?.(bookmark.id, "classifying");
        emit(`Classifying...`);
        const classification = await classifyBookmark({
          bookmark,
          enrichments: enrichResult.enrichments,
          existingSkills
        });

        emit(`  Result: ${classification.type} (${(classification.confidence * 100).toFixed(0)}% confidence)${classification.fallback ? " [fallback]" : ""}`);

        console.log(`[pipeline] Classified bookmark ${bookmark.id}: type=${classification.type} confidence=${classification.confidence.toFixed(2)} fallback=${classification.fallback} rationale="${classification.rationale}"`);

        // Record usage
        if (classification.usage) {
          await recordUsage({
            operation: `classify:${classification.usage.model}`,
            amountUsd: classification.usage.costUsd
          });
        }

        // Step 3: Extract skill content if needed
        if (
          classification.type === "skill" &&
          classification.confidence >= appConfig.classificationReviewThreshold
        ) {
          emit(`  Extracting skill content...`);
          const extraction = await extractSkillContent(bookmark, enrichResult.enrichments);
          if (extraction) {
            classification.extractedSkillContent = extraction.content;
            emit(`  Extracted skill: "${classification.suggestedSkillName ?? "unnamed"}"`);
            if (extraction.usage) {
              await recordUsage({
                operation: `extract:${extraction.usage.model}`,
                amountUsd: extraction.usage.costUsd
              });
            }
          } else {
            // Extraction failed — downgrade to unrelated
            classification.type = "unrelated";
            classification.rationale = "Skill extraction failed — downgraded to unrelated";
            classification.confidence = 0.5;
            emit(`  Skill extraction failed — downgraded to unrelated`);
            console.warn(`[pipeline] Skill extraction failed for bookmark ${bookmark.id} — downgraded to unrelated`);
          }
        }

        // Step 4: Handle classification action
        const actionResult = await handleClassification(
          bookmark,
          classification,
          enrichResult.enrichments,
          null // No sync run ID for pipeline
        );

        console.log(`[pipeline] Action for bookmark ${bookmark.id}: ${actionResult.action}`);

        totalClassified++;
        if (actionResult.skillCreated) {
          totalSkillsCreated++;
          emit(`  Created skill: "${classification.suggestedSkillName ?? "unknown"}"`);
          // Refresh skills list (replace seed skills with real ones)
          existingSkills = await prisma.skill.findMany({
            select: { id: true, name: true, description: true }
          });
        }
        if (actionResult.referenceAttached) {
          totalReferencesAttached++;
          emit(`  Attached as reference to "${classification.matchedSkillName ?? "unknown"}"`);
        }
        if (actionResult.triaged) {
          totalTriaged++;
          emit(`  Sent to triage queue`);
        }
        // Send the actual result as the step so the UI shows the real status
        const finalStep = actionResult.skillCreated
          ? "skill"
          : actionResult.referenceAttached
            ? "reference"
            : actionResult.triaged
              ? "triaged"
              : classification.type === "unrelated"
                ? "unrelated"
                : "done";
        onBookmarkStep?.(bookmark.id, finalStep);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "unknown error";
        emit(`  ERROR: ${errMsg}`);
        console.error(`[pipeline] Error processing bookmark ${bookmark.id}:`, err);
        onBookmarkStep?.(bookmark.id, "failed");
      }

      batchProcessed++;
      totalProcessed++;
    }

    // Continue if we processed a full batch and have time
    continueLoop = batchProcessed === BATCH_LIMIT && Date.now() - startTime < MAX_WALL_CLOCK_MS;
  }

  // Enrichment warning
  let enrichmentWarning: string | undefined;
  if (
    totalEnrichmentCount > 0 &&
    totalFailedEnrichments / totalEnrichmentCount > 0.3
  ) {
    enrichmentWarning = `${totalFailedEnrichments} of ${totalEnrichmentCount} URLs could not be fetched. Consider enabling Browserbase (BROWSERBASE_API_KEY) or Firecrawl for better results.`;
  }

  emit(`Pipeline complete: ${totalProcessed} processed, ${totalSkillsCreated} skills, ${totalReferencesAttached} references, ${totalTriaged} triaged`);

  console.log(`[pipeline] Complete: ${totalProcessed} processed, ${totalSkillsCreated} skills created, ${totalReferencesAttached} references, ${totalTriaged} triaged`);

  return {
    processed: totalProcessed,
    enriched: totalEnriched,
    classified: totalClassified,
    skillsCreated: totalSkillsCreated,
    referencesAttached: totalReferencesAttached,
    triaged: totalTriaged,
    enrichmentWarning,
    log
  };
}
