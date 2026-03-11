import type { Bookmark, BookmarkEnrichment } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { canSpend, recordUsage } from "@/lib/domain/budget";
import { appConfig } from "@/lib/domain/config";
import { fetchUrlContent, isXArticleUrl, MAX_CONTENT_CHARS, MIN_CONTENT_LENGTH, truncate } from "@/lib/enrichment/content-fetcher";
import { extractUrls } from "@/lib/enrichment/url-extractor";

export type EnrichmentResult = {
  enrichments: BookmarkEnrichment[];
  totalUrls: number;
  successCount: number;
  log: string[];
};

function parseRawJson(bookmark: Bookmark): unknown {
  try {
    return JSON.parse(bookmark.rawJson);
  } catch {
    return {};
  }
}

async function findCachedEnrichment(url: string): Promise<BookmarkEnrichment | null> {
  return prisma.bookmarkEnrichment.findFirst({
    where: { url, NOT: { fetchMethod: "failed" }, contentLength: { gte: 500 } }
  });
}

export async function enrichBookmark(bookmark: Bookmark): Promise<EnrichmentResult> {
  const rawJson = parseRawJson(bookmark);
  const urls = extractUrls(bookmark.text, rawJson).slice(0, appConfig.enrichmentMaxUrls);
  const log: string[] = [];

  const enrichments: BookmarkEnrichment[] = [];
  let successCount = 0;

  if (urls.length === 0) {
    log.push("No URLs to enrich");
  }

  for (const { url, source } of urls) {
    const shortUrl = url.length > 70 ? url.slice(0, 67) + "..." : url;

    // Check if we already have an enrichment for this bookmark + URL
    const existing = await prisma.bookmarkEnrichment.findUnique({
      where: { bookmarkId_url: { bookmarkId: bookmark.id, url } }
    });
    if (existing) {
      // Re-fetch if the cached result is thin (< 500 chars) or failed — may get better results now
      const isCachedThin = existing.fetchMethod !== "failed" && existing.contentLength < 500;
      if (existing.fetchMethod === "failed" || isCachedThin) {
        // Delete stale/thin cache entry so we re-fetch below
        await prisma.bookmarkEnrichment.delete({
          where: { id: existing.id }
        });
        log.push(`${shortUrl} — re-fetching (${isCachedThin ? `thin cache: ${existing.contentLength} chars` : "cached failure"})`);
      } else {
        enrichments.push(existing);
        successCount++;
        log.push(`${shortUrl} — cached (${existing.fetchMethod}, ${existing.contentLength} chars)`);
        continue;
      }
    }

    // Check cross-bookmark URL cache
    const cached = await findCachedEnrichment(url);
    if (cached) {
      const record = await prisma.bookmarkEnrichment.create({
        data: {
          bookmarkId: bookmark.id,
          url,
          title: cached.title,
          content: cached.content,
          contentLength: cached.contentLength,
          fetchMethod: cached.fetchMethod
        }
      });
      enrichments.push(record);
      successCount++;
      log.push(`${shortUrl} — shared cache (${cached.fetchMethod}, ${cached.contentLength} chars)`);
      continue;
    }

    // For X article URLs, try extracting note_tweet from rawJson first
    // (available when bookmarks are synced with note_tweet in tweet.fields)
    const noteTweetContent = isXArticleUrl(url)
      ? extractNoteTweetContent(url, rawJson)
      : null;

    if (noteTweetContent) {
      log.push(`${shortUrl} — extracted from bookmark data (note_tweet, ${noteTweetContent.content.length} chars)`);
      const record = await prisma.bookmarkEnrichment.create({
        data: {
          bookmarkId: bookmark.id,
          url,
          title: noteTweetContent.title,
          content: noteTweetContent.content,
          contentLength: noteTweetContent.content.length,
          fetchMethod: "direct"
        }
      });
      enrichments.push(record);
      successCount++;
      continue;
    }

    // For X article URLs, Jina can't fetch /i/article/ paths (returns login stubs).
    // But it CAN fetch /username/status/tweetId — the bookmark already stores this
    // as bookmark.url (set by normalizeTweet in x-client.ts).
    if (isXArticleUrl(url) && bookmark.url) {
      log.push(`${shortUrl} — fetching via status URL (${bookmark.url})...`);
      const statusResult = await fetchUrlContent(bookmark.url);
      if (statusResult.content && statusResult.fetchMethod !== "failed" && statusResult.content.length >= MIN_CONTENT_LENGTH) {
        log.push(`${shortUrl} — OK via ${statusResult.fetchMethod} (${statusResult.content.length} chars)`);
        const record = await prisma.bookmarkEnrichment.create({
          data: {
            bookmarkId: bookmark.id,
            url,
            title: statusResult.title,
            content: statusResult.content,
            contentLength: statusResult.content.length,
            fetchMethod: statusResult.fetchMethod
          }
        });
        enrichments.push(record);
        successCount++;
        continue;
      }
      log.push(`${shortUrl} — status URL also failed: ${statusResult.error ?? "unknown"}`);
    }

    // Fetch the URL content
    log.push(`${shortUrl} — fetching (source: ${source})...`);
    const result = await fetchUrlContent(url);

    // If Firecrawl was used, check budget and record cost
    if (result.firecrawlCostUsd) {
      const withinBudget = await canSpend(result.firecrawlCostUsd);
      if (!withinBudget) {
        const record = await prisma.bookmarkEnrichment.create({
          data: {
            bookmarkId: bookmark.id,
            url,
            title: null,
            content: null,
            contentLength: 0,
            fetchMethod: "failed",
            fetchError: "Budget limit reached for Firecrawl"
          }
        });
        enrichments.push(record);
        log.push(`${shortUrl} — Firecrawl budget exceeded`);
        continue;
      }

      await recordUsage({
        operation: "enrich:firecrawl",
        amountUsd: result.firecrawlCostUsd
      });
    }

    // If fetch failed or returned thin content, try to salvage metadata from rawJson
    let finalContent = result.content || null;
    let finalTitle = result.title;
    let finalMethod = result.fetchMethod;
    let finalLength = result.content?.length ?? 0;
    const isThinResult = finalMethod === "failed" || finalLength < 500;

    if (isThinResult) {
      const meta = extractArticleMetadata(url, rawJson);
      if (meta) {
        if (finalMethod === "failed" || meta.content.length > finalLength) {
          // Metadata is better than what we have
          finalContent = meta.content;
          finalTitle = meta.title;
          finalMethod = finalMethod === "failed" ? "direct" : finalMethod;
          finalLength = meta.content.length;
          const fetchDetail = result.fetchMethod === "failed"
            ? `fetch failed${result.error ? ` [${result.error}]` : ""}`
            : `thin result (${result.content?.length ?? 0} chars)`;
          log.push(`${shortUrl} — ${fetchDetail}, used article metadata: "${meta.title}" (${finalLength} chars)`);
        } else {
          log.push(`${shortUrl} — OK via ${finalMethod} (${finalLength} chars)`);
        }
      } else if (finalMethod === "failed") {
        log.push(`${shortUrl} — FAILED: ${result.error ?? "unknown error"}`);
      } else {
        log.push(`${shortUrl} — OK via ${finalMethod} (${finalLength} chars, thin)`);
      }
    } else {
      log.push(`${shortUrl} — OK via ${finalMethod} (${finalLength} chars)`);
    }

    const record = await prisma.bookmarkEnrichment.create({
      data: {
        bookmarkId: bookmark.id,
        url,
        title: finalTitle,
        content: finalContent,
        contentLength: finalLength,
        fetchMethod: finalMethod,
        fetchError: finalMethod === "failed" ? result.error : undefined
      }
    });
    enrichments.push(record);
    if (finalMethod !== "failed") successCount++;
  }

  return { enrichments, totalUrls: urls.length, successCount, log };
}

// Extract full article content from note_tweet in rawJson
// note_tweet is available when bookmarks are synced with note_tweet in tweet.fields
function extractNoteTweetContent(
  url: string,
  rawJson: unknown
): { title: string | null; content: string } | null {
  if (!rawJson || typeof rawJson !== "object") return null;
  const json = rawJson as Record<string, unknown>;

  const noteTweet = json.note_tweet as Record<string, unknown> | undefined;
  if (!noteTweet) return null;

  const noteText = typeof noteTweet.text === "string" ? noteTweet.text : null;
  if (!noteText || noteText.length < MIN_CONTENT_LENGTH) return null;

  // Build content with author attribution
  const authorId = json.author_id as string | undefined;
  const lines: string[] = [];
  lines.push(noteText);

  let content = lines.join("\n");

  // Expand t.co URLs using note_tweet entities
  const entities = noteTweet.entities as Record<string, unknown> | undefined;
  if (entities?.urls && Array.isArray(entities.urls)) {
    for (const entry of entities.urls as Array<Record<string, unknown>>) {
      const shortUrl = entry.url as string | undefined;
      const expandedUrl = entry.expanded_url as string | undefined;
      if (shortUrl && expandedUrl) {
        content = content.replaceAll(shortUrl, expandedUrl);
      }
    }
  }

  return {
    title: null,
    content: truncate(content, MAX_CONTENT_CHARS)
  };
}

// Extract article title/description from tweet rawJson when URL fetch fails
function extractArticleMetadata(
  url: string,
  rawJson: unknown
): { title: string; content: string } | null {
  if (!rawJson || typeof rawJson !== "object") return null;
  const json = rawJson as Record<string, unknown>;

  // Check $.article.title (X article metadata)
  const article = json.article as Record<string, unknown> | undefined;
  if (article?.title && typeof article.title === "string") {
    const title = article.title;
    const desc = typeof article.description === "string" ? article.description : "";
    const content = desc ? `# ${title}\n\n${desc}` : `# ${title}`;
    return { title, content };
  }

  // Check entity URL metadata (unwound_url title/description)
  const entities = json.entities as Record<string, unknown> | undefined;
  if (entities?.urls && Array.isArray(entities.urls)) {
    for (const entry of entities.urls as Array<Record<string, unknown>>) {
      const expanded = entry.expanded_url ?? entry.unwound_url;
      if (typeof expanded === "string" && expanded.includes(new URL(url).pathname)) {
        const entryTitle = entry.title as string | undefined;
        const entryDesc = entry.description as string | undefined;
        if (entryTitle) {
          const content = entryDesc
            ? `# ${entryTitle}\n\n${entryDesc}`
            : `# ${entryTitle}`;
          return { title: entryTitle, content };
        }
      }
    }
  }

  return null;
}
