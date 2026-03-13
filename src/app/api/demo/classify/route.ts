import { NextResponse } from "next/server";
import type { Bookmark, BookmarkEnrichment } from "@prisma/client";
import {
  classifyBookmark,
  generateMicroSkillContent,
} from "@/lib/classification/classifier";
import { fetchUrlContent } from "@/lib/enrichment/content-fetcher";

const JINA_TIMEOUT_MS = 30_000;
const MAX_CONTENT_CHARS = 50_000;

// Jina Reader fallback for JS-heavy pages (X.com articles, SPAs, etc.)
async function fetchViaJina(
  url: string
): Promise<{ content: string; title: string | null } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/markdown" },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text || text.length < 100) return null;

    // Jina prepends a "Title: ...\nURL: ...\n\n" header — extract title
    let title: string | null = null;
    let body = text;
    const titleMatch = text.match(/^Title:\s*(.+)\n/);
    if (titleMatch) {
      title = titleMatch[1].trim();
      // Strip the header block (Title + URL + blank line)
      body = text.replace(/^Title:.*\nURL:.*\n\n?/, "");
    }

    return {
      content: body.length > MAX_CONTENT_CHARS ? body.slice(0, MAX_CONTENT_CHARS) + "\n\n[truncated]" : body,
      title,
    };
  } catch {
    return null;
  }
}

// Try the main fetcher, fall back to Jina Reader for JS-heavy pages
async function fetchContent(url: string) {
  const result = await fetchUrlContent(url);
  if (result.content && result.fetchMethod !== "failed") {
    return result;
  }

  // Fallback: Jina Reader (handles JS rendering)
  const jina = await fetchViaJina(url);
  if (jina) {
    return {
      content: jina.content,
      title: jina.title,
      fetchMethod: "jina-reader" as const,
      resolvedUrl: url,
      error: undefined,
    };
  }

  return result; // Return original failure
}

const SEED_BUCKETS = [
  {
    id: "__seed__agents",
    name: "agents",
    displayName: "Agents",
    description: "AI agents, prompting, automation, system prompts, and skill design.",
  },
  {
    id: "__seed__ux-ui",
    name: "ux-ui",
    displayName: "UX UI",
    description: "UX, UI, and product experience patterns.",
  },
  {
    id: "__seed__growth",
    name: "growth",
    displayName: "Growth",
    description: "Growth, acquisition, messaging, and distribution strategies.",
  },
];

// Fetch-only endpoint: resolve a URL to its content without classifying
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "url parameter is required" }, { status: 400 });
  }

  const result = await fetchContent(url);

  return NextResponse.json({
    url,
    resolvedUrl: result.resolvedUrl ?? url,
    title: result.title,
    content: result.content || null,
    fetchMethod: result.fetchMethod,
    error: result.error,
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const {
    tweetText = "",
    content = "",
    url,
    authorHandle = "demo_user",
  } = body as {
    tweetText?: string;
    content?: string;
    url?: string;
    authorHandle?: string;
  };

  if (!tweetText && !content && !url) {
    return NextResponse.json(
      { error: "Provide tweetText, content, or a url to fetch" },
      { status: 400 }
    );
  }

  const now = new Date();
  const fakeId = `demo_${Date.now()}`;

  const bookmark: Bookmark = {
    id: fakeId,
    text: tweetText,
    authorHandle,
    authorName: null,
    url: `https://x.com/${authorHandle}/status/${fakeId}`,
    rawJson: "{}",
    bookmarkedAt: now,
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  // Build enrichments: use fetched URL content, pasted content, or both
  const enrichments: BookmarkEnrichment[] = [];

  if (url) {
    const fetched = await fetchContent(url);
    enrichments.push({
      id: `demo_enrichment_url_${Date.now()}`,
      bookmarkId: fakeId,
      url: fetched.resolvedUrl ?? url,
      title: fetched.title ?? null,
      content: fetched.content || null,
      contentLength: fetched.content?.length ?? 0,
      fetchMethod: fetched.fetchMethod,
      fetchError: fetched.error ?? null,
      fetchedAt: now,
    });
  }

  if (content) {
    enrichments.push({
      id: `demo_enrichment_paste_${Date.now()}`,
      bookmarkId: fakeId,
      url: "https://example.com/demo-paste",
      title: "Pasted content",
      content,
      contentLength: content.length,
      fetchMethod: "demo-paste",
      fetchError: null,
      fetchedAt: now,
    });
  }

  const classification = await classifyBookmark({
    bookmark,
    enrichments,
    existingBuckets: SEED_BUCKETS,
  });

  let extractedContent: string | undefined;

  if (classification.roleType === "MICRO_SKILL") {
    const bucket = {
      id: "demo_bucket",
      name: classification.bucketName,
      displayName: classification.bucketDisplayName,
      description: classification.bucketDescription,
      dirtySince: null,
      lastMasterSynthesizedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const extraction = await generateMicroSkillContent({
      bookmark,
      enrichments,
      bucket,
      skillName: classification.microSkillName ?? `${classification.bucketName}-micro-skill`,
    });
    if (extraction) {
      extractedContent = extraction.content;
    }
  }

  return NextResponse.json({ classification, extractedContent });
}
