import TurndownService from "turndown";

import { appConfig } from "@/lib/domain/config";
import { getActiveXToken } from "@/lib/auth/token-store";
import { getX402Fetch } from "@/lib/enrichment/x402-client";
import { fetchViaBrowserbase, isBrowserbaseConfigured } from "@/lib/enrichment/browserbase-scraper";

export type FetchResult = {
  content: string;
  title: string | null;
  fetchMethod: "direct" | "firecrawl" | "playwright" | "browserbase" | "jina" | "failed";
  error?: string;
  firecrawlCostUsd?: number;
  resolvedUrl?: string;
};

const MAX_BODY_BYTES = 500 * 1024; // 500KB
export const MAX_CONTENT_CHARS = 50_000;
export const MIN_CONTENT_LENGTH = 50;
const MIN_ARTICLE_CONTENT_LENGTH = 200;
const MIN_X_ARTICLE_CONTENT_LENGTH = 800; // X articles are long-form; <800 chars is a login stub
const MAX_CONCURRENT = 3;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Patterns that indicate a failed or garbage fetch
const GARBAGE_PATTERNS = [
  "javascript is not available",
  "please enable javascript",
  "noscript",
  "you need to enable javascript",
  "browser does not support javascript",
  "this browser is no longer supported",
  "log in to x",
  "sign up for x",
  "sign in to x",
  "log in to twitter",
  "sign up for twitter",
  "sign in to twitter",
  "to view this article",
  "this post is from",
  "something went wrong",
  "page isn\u2019t available",
  "page isn't available",
  "content is not available",
  "authorize your app",
  "verify your identity",
];

let activeFetches = 0;
const fetchQueue: Array<() => void> = [];

async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  while (activeFetches >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => fetchQueue.push(resolve));
  }
  activeFetches++;
  try {
    return await fn();
  } finally {
    activeFetches--;
    const next = fetchQueue.shift();
    if (next) next();
  }
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "\n\n[truncated]";
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1]?.trim() || null;
}

export function isGarbageContent(text: string): boolean {
  const lower = text.toLowerCase();
  if (text.length < MIN_ARTICLE_CONTENT_LENGTH) return true;
  return GARBAGE_PATTERNS.some((p) => lower.includes(p));
}

// ─── t.co / shortlink resolution ────────────────────────────────────

function isShortUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "t.co" || h === "bit.ly" || h === "tinyurl.com" || h === "ow.ly";
  } catch {
    return false;
  }
}

async function resolveRedirects(url: string): Promise<string> {
  // Note: Next.js patches fetch so redirect: "manual" doesn't work reliably.
  // For t.co URLs, we filter them in the URL extractor and use expanded_url
  // from tweet entities instead. This fallback only applies to other shortlinks.
  try {
    const resp = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": BROWSER_UA },
    });
    const location = resp.headers.get("location");
    if (location && resp.status >= 300 && resp.status < 400) {
      return new URL(location, url).href;
    }
    return url;
  } catch {
    return url;
  }
}

// ─── Special URL handlers ────────────────────────────────────────────

function isGitHubRepoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return false;
    const parts = parsed.pathname.split("/").filter(Boolean);
    // Only match owner/repo (not /blob/, /issues/, etc.)
    return parts.length === 2;
  } catch {
    return false;
  }
}

function toRawReadmeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`;
  } catch {
    return null;
  }
}

function isGistUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "gist.github.com";
  } catch {
    return false;
  }
}

function toGistRawUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "gist.github.com") return null;
    return `https://gist.githubusercontent.com${parsed.pathname}/raw`;
  } catch {
    return null;
  }
}

export function isXArticleUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "x.com" || parsed.hostname === "twitter.com") &&
      parsed.pathname.includes("/article/")
    );
  } catch {
    return false;
  }
}

// ─── Core fetch ──────────────────────────────────────────────────────

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), appConfig.enrichmentFetchTimeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndown.remove(["script", "style", "nav", "footer", "header", "aside"]);
  return turndown.turndown(html).trim();
}

async function fetchDirect(url: string): Promise<FetchResult> {
  // GitHub repo → raw README
  if (isGitHubRepoUrl(url)) {
    const rawUrl = toRawReadmeUrl(url);
    if (rawUrl) {
      try {
        const resp = await fetchWithTimeout(rawUrl);
        if (resp.ok) {
          const text = await resp.text();
          if (text.length >= MIN_CONTENT_LENGTH) {
            return { content: truncate(text, MAX_CONTENT_CHARS), title: null, fetchMethod: "direct" };
          }
        }
      } catch {
        // Fall through to standard fetch
      }
    }
  }

  // Gist → raw content
  if (isGistUrl(url)) {
    const rawUrl = toGistRawUrl(url);
    if (rawUrl) {
      try {
        const resp = await fetchWithTimeout(rawUrl);
        if (resp.ok) {
          const text = await resp.text();
          if (text.length >= MIN_CONTENT_LENGTH) {
            return { content: truncate(text, MAX_CONTENT_CHARS), title: null, fetchMethod: "direct" };
          }
        }
      } catch {
        // Fall through to standard fetch
      }
    }
  }

  const resp = await fetchWithTimeout(url);
  if (!resp.ok) {
    return { content: "", title: null, fetchMethod: "failed", error: `HTTP ${resp.status}` };
  }

  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    return { content: "", title: null, fetchMethod: "failed", error: `Unsupported content type: ${contentType}` };
  }

  const buffer = await resp.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) {
    return { content: "", title: null, fetchMethod: "failed", error: "Response too large" };
  }

  const html = new TextDecoder().decode(buffer);
  const title = extractTitle(html);

  let text: string;
  if (contentType.includes("text/plain")) {
    text = html.trim();
  } else {
    text = htmlToMarkdown(html);
  }

  if (text.length < MIN_CONTENT_LENGTH) {
    return { content: "", title, fetchMethod: "failed", error: "Content too short" };
  }

  // Quality gate: detect garbage content (JS error pages, etc.)
  if (isGarbageContent(text)) {
    return { content: "", title, fetchMethod: "failed", error: "Content is a JavaScript-required error page" };
  }

  return { content: truncate(text, MAX_CONTENT_CHARS), title, fetchMethod: "direct" };
}

const FIRECRAWL_URL = "https://stableenrich.dev/api/firecrawl/scrape";
const FIRECRAWL_COST_USD = 0.0126;

async function fetchViaFirecrawl(url: string): Promise<FetchResult> {
  const x402Fetch = getX402Fetch();
  if (!x402Fetch) {
    return { content: "", title: null, fetchMethod: "failed", error: "No x402 wallet configured for Firecrawl" };
  }

  try {
    const resp = await x402Fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(appConfig.enrichmentFetchTimeoutMs * 3),
    });

    if (!resp.ok) {
      return { content: "", title: null, fetchMethod: "failed", error: `Firecrawl HTTP ${resp.status}` };
    }

    const data = (await resp.json()) as { markdown?: string; title?: string; metadata?: { title?: string } };
    const markdown = (data.markdown?.trim() ?? "");
    const title = data.title ?? data.metadata?.title ?? null;

    if (markdown.length < MIN_CONTENT_LENGTH) {
      return { content: "", title, fetchMethod: "failed", error: "Firecrawl content too short" };
    }

    return {
      content: truncate(markdown, MAX_CONTENT_CHARS),
      title,
      fetchMethod: "firecrawl",
      firecrawlCostUsd: FIRECRAWL_COST_USD,
    };
  } catch (error) {
    return {
      content: "",
      title: null,
      fetchMethod: "failed",
      error: error instanceof Error ? error.message : "Firecrawl fetch failed",
    };
  }
}

const JINA_TIMEOUT_MS = 30_000;

async function fetchViaJina(url: string): Promise<FetchResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/markdown" },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      return { content: "", title: null, fetchMethod: "failed", error: `Jina HTTP ${resp.status}` };
    }
    const text = await resp.text();
    if (!text || text.length < MIN_CONTENT_LENGTH) {
      return { content: "", title: null, fetchMethod: "failed", error: "Jina: content too short" };
    }

    let title: string | null = null;
    let body = text;
    const titleMatch = text.match(/^Title:\s*(.+)\n/);
    if (titleMatch) {
      title = titleMatch[1].trim();
      body = text.replace(/^Title:.*\nURL:.*\n\n?/, "");
    }

    if (isGarbageContent(body)) {
      return { content: "", title, fetchMethod: "failed", error: "Jina: content is a login/error page" };
    }

    return {
      content: truncate(body, MAX_CONTENT_CHARS),
      title,
      fetchMethod: "jina",
    };
  } catch {
    return { content: "", title: null, fetchMethod: "failed", error: "Jina fetch failed" };
  }
}

function extractXArticleId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/article\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

type XTweetResponse = {
  data?: {
    id: string;
    text?: string;
    author_id?: string;
    note_tweet?: {
      text?: string;
      entities?: {
        urls?: Array<{ url?: string; expanded_url?: string; display_url?: string }>;
      };
    };
  };
  includes?: {
    users?: Array<{ id: string; username?: string; name?: string }>;
  };
};

async function fetchXArticleViaApi(url: string): Promise<FetchResult> {
  const articleId = extractXArticleId(url);
  if (!articleId) {
    return { content: "", title: null, fetchMethod: "failed", error: "Could not extract article ID from URL" };
  }

  const token = await getActiveXToken();
  if (!token) {
    console.log(`[x-article] No active X token`);
    return { content: "", title: null, fetchMethod: "failed", error: "X account not connected" };
  }

  try {
    const apiBase = appConfig.xApiBaseUrl.endsWith("/")
      ? appConfig.xApiBaseUrl.slice(0, -1)
      : appConfig.xApiBaseUrl;

    const params = new URLSearchParams({
      "tweet.fields": "note_tweet,entities,created_at,author_id",
      expansions: "author_id",
      "user.fields": "name,username",
    });

    const apiUrl = `${apiBase}/2/tweets/${articleId}?${params}`;
    console.log(`[x-article] Fetching ${apiUrl}`);

    const resp = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      signal: AbortSignal.timeout(appConfig.enrichmentFetchTimeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const error = `X API ${resp.status}: ${text.slice(0, 200)}`;
      console.log(`[x-article] API error for ${articleId}: ${error}`);
      return { content: "", title: null, fetchMethod: "failed", error };
    }

    const data = (await resp.json()) as XTweetResponse;
    const tweet = data.data;

    console.log(`[x-article] API response for ${articleId}: text=${tweet?.text?.length ?? 0} chars, note_tweet=${tweet?.note_tweet?.text?.length ?? 0} chars`);

    if (!tweet) {
      return { content: "", title: null, fetchMethod: "failed", error: "X API returned no tweet data" };
    }

    // note_tweet contains the full long-form content for articles/notes
    const noteText = tweet.note_tweet?.text;
    const tweetText = tweet.text;
    const fullText = noteText ?? tweetText;

    if (!fullText || fullText.length < MIN_CONTENT_LENGTH) {
      return { content: "", title: null, fetchMethod: "failed", error: `X API: content too short (${fullText?.length ?? 0} chars)` };
    }

    // Build a readable markdown document from the article content
    const author = data.includes?.users?.find((u) => u.id === tweet.author_id);
    const authorLabel = author ? `${author.name ?? author.username} (@${author.username})` : null;
    const lines: string[] = [];
    if (authorLabel) lines.push(`*By ${authorLabel}*\n`);
    lines.push(fullText);

    // Expand t.co URLs in the text using entity data
    let content = lines.join("\n");
    const urls = tweet.note_tweet?.entities?.urls ?? [];
    for (const u of urls) {
      if (u.url && u.expanded_url) {
        content = content.replaceAll(u.url, u.expanded_url);
      }
    }

    return {
      content: truncate(content, MAX_CONTENT_CHARS),
      title: null,
      fetchMethod: "direct",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown error";
    console.log(`[x-article] Exception for ${articleId}: ${msg}`);
    return {
      content: "",
      title: null,
      fetchMethod: "failed",
      error: `X API: ${msg}`,
    };
  }
}

export async function fetchUrlContent(url: string): Promise<FetchResult> {
  return withConcurrencyLimit(async () => {
    // Step 0: Resolve shortlinks (t.co, bit.ly, etc.) to actual destination
    let resolvedUrl = url;
    if (isShortUrl(url)) {
      resolvedUrl = await resolveRedirects(url);
    }

    // Step 1: X.com articles — fetch via X API using the user's OAuth token.
    // The article ID in the URL is a tweet ID; note_tweet field has full content.
    // Jina can't fetch /i/article/ URLs (returns login stubs), but CAN fetch
    // /i/web/status/ URLs. Convert article URL → status URL for Jina.
    if (isXArticleUrl(resolvedUrl)) {
      const articleId = extractXArticleId(resolvedUrl);

      // Try Jina with the status URL format (works like the demo's fetch)
      if (articleId) {
        const statusUrl = `https://x.com/i/web/status/${articleId}`;
        const jinaResult = await fetchViaJina(statusUrl);
        if (jinaResult.fetchMethod === "jina" && jinaResult.content.length >= MIN_X_ARTICLE_CONTENT_LENGTH) {
          return { ...jinaResult, resolvedUrl };
        }
      }

      // X API fallback — requires Basic tier ($200/mo), works if available
      const apiResult = await fetchXArticleViaApi(resolvedUrl);
      if (apiResult.fetchMethod !== "failed" && apiResult.content.length >= MIN_CONTENT_LENGTH) {
        return { ...apiResult, resolvedUrl };
      }

      // Browserbase fallback — only if configured with auth context
      if (isBrowserbaseConfigured() && appConfig.browserbaseContextId) {
        const bbResult = await fetchViaBrowserbase(resolvedUrl);
        if (bbResult.fetchMethod === "browserbase" && bbResult.content.length >= MIN_X_ARTICLE_CONTENT_LENGTH) {
          return { ...bbResult, resolvedUrl };
        }
      }

      return {
        content: "",
        title: null,
        fetchMethod: "failed" as const,
        error: apiResult.error ?? "X article fetch failed — all methods tried",
        resolvedUrl,
      };
    }

    // Step 2: Try direct fetch on the resolved URL
    const errors: string[] = [];
    const directResult = await fetchDirect(resolvedUrl).catch((error) => ({
      content: "",
      title: null as string | null,
      fetchMethod: "failed" as const,
      error: error instanceof Error ? error.message : "Direct fetch failed",
    }));

    if (directResult.fetchMethod === "direct" && directResult.content.length >= MIN_CONTENT_LENGTH) {
      return { ...directResult, resolvedUrl };
    }
    errors.push(`direct: ${directResult.error ?? "too short"}`);

    // Step 3: Try Browserbase as general fallback for JS-heavy sites
    if (isBrowserbaseConfigured()) {
      const bbResult = await fetchViaBrowserbase(resolvedUrl);
      if (bbResult.fetchMethod === "browserbase") {
        return { ...bbResult, resolvedUrl };
      }
      errors.push(`browserbase: ${bbResult.error ?? "too short"}`);
    }

    // Step 4: Try Jina Reader fallback (free, handles JS rendering)
    const jinaResult = await fetchViaJina(resolvedUrl);
    if (jinaResult.fetchMethod === "jina") {
      return { ...jinaResult, resolvedUrl };
    }
    errors.push(`jina: ${jinaResult.error ?? "too short"}`);

    // Step 5: Try Firecrawl fallback
    const firecrawlResult = await fetchViaFirecrawl(resolvedUrl);
    if (firecrawlResult.fetchMethod === "firecrawl") {
      return { ...firecrawlResult, resolvedUrl };
    }
    errors.push(`firecrawl: ${firecrawlResult.error ?? "too short"}`);

    // All failed — return per-method errors
    return {
      content: "",
      title: directResult.title,
      fetchMethod: "failed" as const,
      error: errors.join(" | "),
      resolvedUrl,
    };
  });
}
