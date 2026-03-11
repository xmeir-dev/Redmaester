import { chromium } from "playwright-core";

import { appConfig } from "@/lib/domain/config";
import {
  type FetchResult,
  htmlToMarkdown,
  truncate,
  isGarbageContent,
  MAX_CONTENT_CHARS,
  MIN_CONTENT_LENGTH,
} from "@/lib/enrichment/content-fetcher";
import {
  graphqlContentToMarkdown,
  findNestedString,
  MIN_CONTENT_LENGTH as PARSER_MIN_LENGTH,
} from "@/lib/enrichment/x-article-parser";

export function isBrowserbaseConfigured(): boolean {
  return !!(appConfig.browserbaseApiKey && appConfig.browserbaseProjectId);
}

async function createBrowserbaseSession(useContext: boolean): Promise<{ id: string; connectUrl: string }> {
  const body: Record<string, unknown> = {
    projectId: appConfig.browserbaseProjectId,
  };
  if (useContext && appConfig.browserbaseContextId) {
    body.browserSettings = { context: { id: appConfig.browserbaseContextId, persist: true } };
  }

  const resp = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bb-api-key": appConfig.browserbaseApiKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Browserbase session creation failed: HTTP ${resp.status} — ${text}`);
  }

  const data = (await resp.json()) as { id: string; connectUrl?: string };
  const connectUrl = data.connectUrl ?? `wss://connect.browserbase.com?apiKey=${appConfig.browserbaseApiKey}&sessionId=${data.id}`;
  return { id: data.id, connectUrl };
}

function isXUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "x.com" || h === "twitter.com";
  } catch {
    return false;
  }
}

export async function fetchViaBrowserbase(url: string): Promise<FetchResult> {
  if (!isBrowserbaseConfigured()) {
    return {
      content: "",
      title: null,
      fetchMethod: "failed",
      error: "Browserbase not configured (missing BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID)",
    };
  }

  let browser;
  try {
    const useContext = isXUrl(url) && !!appConfig.browserbaseContextId;
    const session = await createBrowserbaseSession(useContext);

    browser = await chromium.connectOverCDP(session.connectUrl, {
      timeout: appConfig.playwrightTimeoutMs,
    });

    const defaultContext = browser.contexts()[0];
    if (!defaultContext) {
      return {
        content: "",
        title: null,
        fetchMethod: "failed",
        error: "Browserbase: no browser context available",
      };
    }

    const page = defaultContext.pages()[0] ?? await defaultContext.newPage();

    // Set up GraphQL response interception for X articles
    let graphqlContent: string | null = null;
    let articleTitle: string | null = null;

    if (isXUrl(url)) {
      page.on("response", async (response) => {
        try {
          const reqUrl = response.url();
          if (!reqUrl.includes("/i/api/graphql/")) return;
          if (response.status() !== 200) return;

          const json = await response.json();
          const markdown = graphqlContentToMarkdown(json);
          if (markdown && markdown.length >= PARSER_MIN_LENGTH) {
            graphqlContent = markdown;

            const data = json as Record<string, unknown>;
            const title = findNestedString(data, "title");
            if (title) articleTitle = title;
          }
        } catch {
          // Ignore parsing errors on non-article GraphQL responses
        }
      });
    }

    // Navigate
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: appConfig.playwrightTimeoutMs,
    });

    // Check for login redirect on X
    if (isXUrl(url) && (page.url().includes("/login") || page.url().includes("/i/flow/login"))) {
      return {
        content: "",
        title: null,
        fetchMethod: "failed",
        error: "Browserbase: X.com login required — set up BROWSERBASE_CONTEXT_ID with an authenticated session",
      };
    }

    // Wait for content to load
    await page.waitForTimeout(3000);

    // Strategy 1: GraphQL intercepted content (X articles)
    if (graphqlContent) {
      const content = truncate(graphqlContent, MAX_CONTENT_CHARS);
      return {
        content,
        title: articleTitle,
        fetchMethod: "browserbase",
      };
    }

    // Strategy 2: DOM extraction
    const html = await page.content();
    const title = await page.title();

    const markdown = htmlToMarkdown(html);

    if (markdown.length < MIN_CONTENT_LENGTH) {
      return {
        content: "",
        title: title || null,
        fetchMethod: "failed",
        error: "Browserbase: extracted content too short",
      };
    }

    if (isGarbageContent(markdown)) {
      return {
        content: "",
        title: title || null,
        fetchMethod: "failed",
        error: "Browserbase: content is garbage (JS error page)",
      };
    }

    return {
      content: truncate(markdown, MAX_CONTENT_CHARS),
      title: title || null,
      fetchMethod: "browserbase",
    };
  } catch (error) {
    return {
      content: "",
      title: null,
      fetchMethod: "failed",
      error: `Browserbase: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
