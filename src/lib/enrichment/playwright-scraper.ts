import { chromium } from "playwright";

import { appConfig } from "@/lib/domain/config";
import {
  type FetchResult,
  htmlToMarkdown,
  truncate,
  isGarbageContent,
  MAX_CONTENT_CHARS,
  MIN_CONTENT_LENGTH,
} from "@/lib/enrichment/content-fetcher";
import { getXCookies, invalidateCookieCache } from "@/lib/enrichment/chrome-cookies";
import {
  graphqlContentToMarkdown,
  findNestedString,
  MIN_CONTENT_LENGTH as PARSER_MIN_LENGTH,
} from "@/lib/enrichment/x-article-parser";

export async function fetchViaPlaywright(url: string): Promise<FetchResult> {
  const cookies = await getXCookies();
  if (!cookies) {
    return {
      content: "",
      title: null,
      fetchMethod: "failed",
      error: "Could not extract X.com cookies from Chrome — ensure you're logged into X.com in Chrome",
    };
  }

  let browser;
  try {
    // Random delay 1-3s for minimal anti-detection
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies(cookies);

    const page = await context.newPage();

    // Set up GraphQL response interception
    let graphqlContent: string | null = null;
    let articleTitle: string | null = null;

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

    // Navigate to article
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: appConfig.playwrightTimeoutMs,
    });

    // Check for login redirect — cookies are stale
    if (page.url().includes("/login") || page.url().includes("/i/flow/login")) {
      await context.close();
      invalidateCookieCache();
      return {
        content: "",
        title: null,
        fetchMethod: "failed",
        error: "X.com session expired — please log into X.com in Chrome and retry",
      };
    }

    // Wait for content to load
    await page.waitForTimeout(3000);

    // Strategy 1: Use GraphQL intercepted content
    if (graphqlContent) {
      const content = truncate(graphqlContent, MAX_CONTENT_CHARS);
      await context.close();
      return {
        content,
        title: articleTitle,
        fetchMethod: "playwright",
      };
    }

    // Strategy 2: DOM extraction fallback
    const html = await page.content();
    const title = await page.title();
    await context.close();

    const markdown = htmlToMarkdown(html);

    if (markdown.length < MIN_CONTENT_LENGTH) {
      return {
        content: "",
        title: title || null,
        fetchMethod: "failed",
        error: "Playwright: extracted content too short",
      };
    }

    if (isGarbageContent(markdown)) {
      return {
        content: "",
        title: title || null,
        fetchMethod: "failed",
        error: "Playwright: content is garbage (JS error page)",
      };
    }

    return {
      content: truncate(markdown, MAX_CONTENT_CHARS),
      title: title || null,
      fetchMethod: "playwright",
    };
  } catch (error) {
    return {
      content: "",
      title: null,
      fetchMethod: "failed",
      error: `Playwright: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
