import type { BookmarkInput } from "@/lib/domain/types";
import { appConfig } from "@/lib/domain/config";
import { getActiveXToken } from "@/lib/auth/token-store";
import { mockBookmarks } from "@/lib/sync/mock-bookmarks";
import { loadSyncState } from "@/lib/sync/sync-state";
import type { BookmarkFetchOptions, BookmarkFetchResult } from "@/lib/sync/types";

export type BookmarkCountResult = {
  count: number;
  apiCalls: number;
  stoppedReason?: "rate_limit" | "credits_depleted";
};

export interface XClient {
  fetchBookmarks(options: BookmarkFetchOptions): Promise<BookmarkFetchResult>;
  countBookmarks(): Promise<BookmarkCountResult>;
}

class MockXClient implements XClient {
  async countBookmarks(): Promise<BookmarkCountResult> {
    return { count: mockBookmarks.length, apiCalls: 1 };
  }

  async fetchBookmarks(options: BookmarkFetchOptions): Promise<BookmarkFetchResult> {
    return {
      bookmarks: mockBookmarks.slice(0, options.limit)
    };
  }

}

type XTweet = {
  id: string;
  text?: string;
  created_at?: string;
  author_id?: string;
  attachments?: {
    media_keys?: string[];
  };
  entities?: {
    urls?: Array<{
      url?: string;
      expanded_url?: string;
      display_url?: string;
      title?: string;
    }>;
  };
};

type XUser = {
  id: string;
  username?: string;
  name?: string;
};

type XCollectionResponse = {
  data?: XTweet[];
  includes?: {
    users?: XUser[];
    media?: XMedia[];
  };
  meta?: {
    next_token?: string;
  };
};

type XMedia = {
  media_key?: string;
  type?: string;
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
};

function xApiUrl(path: string): string {
  const base = appConfig.xApiBaseUrl.endsWith("/") ? appConfig.xApiBaseUrl.slice(0, -1) : appConfig.xApiBaseUrl;
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

async function fetchFromX<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(xApiUrl(path), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`X API request failed (${response.status}) for ${path}: ${message}`);
  }

  return (await response.json()) as T;
}

function isBadRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("X API request failed (400)");
}

function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("(429)");
}

function isCreditsDepletedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("(402)") && error.message.includes("CreditsDepleted");
}

function normalizeTweet(
  tweet: XTweet,
  usersById: Map<string, XUser>,
  mediaByKey: Map<string, XMedia>
): BookmarkInput {
  const author = tweet.author_id ? usersById.get(tweet.author_id) : undefined;
  const attachedMedia = (tweet.attachments?.media_keys ?? [])
    .map((key) => mediaByKey.get(key))
    .filter((media): media is XMedia => Boolean(media));
  const rawJson = attachedMedia.length > 0 ? { ...tweet, media: attachedMedia } : tweet;

  return {
    id: tweet.id,
    text: tweet.text ?? "",
    authorHandle: author?.username ?? "unknown",
    authorName: author?.name,
    url: `https://x.com/${author?.username ?? "i"}/status/${tweet.id}`,
    bookmarkedAt: tweet.created_at ? new Date(tweet.created_at) : new Date(),
    rawJson
  };
}

class OfficialXClient implements XClient {
  async countBookmarks(): Promise<BookmarkCountResult> {
    const token = await getActiveXToken();
    if (!token) {
      throw new Error("X account is not connected. Use /api/auth/x/start first.");
    }

    // Use the same parameters as fetchBookmarks to ensure consistent API behavior
    const pageSize = Math.max(5, Math.min(100, appConfig.fullSyncPageSize));

    let count = 0;
    let apiCalls = 0;
    let nextToken: string | undefined;

    // Also try resuming from saved cursor to count remaining bookmarks
    const state = await loadSyncState();
    let cursorCount = 0;
    let cursorApiCalls = 0;

    // Phase 1: Count from the beginning (fresh, no cursor)
    while (apiCalls < 500) {
      const params = new URLSearchParams({
        max_results: String(pageSize),
        "tweet.fields": "created_at,author_id,attachments,entities,note_tweet",
        expansions: "author_id,attachments.media_keys",
        "user.fields": "name,username",
        "media.fields": "type,url,preview_image_url,alt_text",
      });
      if (nextToken) {
        params.set("pagination_token", nextToken);
      }

      let response: XCollectionResponse;
      try {
        response = await fetchFromX<XCollectionResponse>(
          `/2/users/${token.userId}/bookmarks?${params.toString()}`,
          token.accessToken
        );
        apiCalls++;
      } catch (error) {
        if (isRateLimitError(error)) {
          return { count, apiCalls, stoppedReason: "rate_limit" };
        }
        if (isCreditsDepletedError(error)) {
          return { count, apiCalls, stoppedReason: "credits_depleted" };
        }
        throw error;
      }

      const pageCount = (response.data ?? []).length;
      count += pageCount;
      console.log(`[count] Page ${apiCalls}: ${pageCount} bookmarks (total so far: ${count}, next_token: ${response.meta?.next_token ? "yes" : "no"})`);
      nextToken = response.meta?.next_token;
      if (!nextToken) break;
    }

    // Phase 2: If there's a saved cursor from a previous full sync,
    // count from that position too (the API may expose more bookmarks via cursor)
    if (state.fullSyncCursor) {
      console.log(`[count] Saved cursor found — counting from cursor position...`);
      let cursorToken: string | undefined = state.fullSyncCursor;

      while (cursorApiCalls < 500) {
        const params = new URLSearchParams({
          max_results: String(pageSize),
          "tweet.fields": "created_at,author_id,attachments,entities,note_tweet",
          expansions: "author_id,attachments.media_keys",
          "user.fields": "name,username",
          "media.fields": "type,url,preview_image_url,alt_text",
        });
        if (cursorToken) {
          params.set("pagination_token", cursorToken);
        }

        let response: XCollectionResponse;
        try {
          response = await fetchFromX<XCollectionResponse>(
            `/2/users/${token.userId}/bookmarks?${params.toString()}`,
            token.accessToken
          );
          cursorApiCalls++;
        } catch (error) {
          if (isRateLimitError(error) || isCreditsDepletedError(error)) {
            break;
          }
          throw error;
        }

        const pageCount = (response.data ?? []).length;
        cursorCount += pageCount;
        console.log(`[count] Cursor page ${cursorApiCalls}: ${pageCount} bookmarks (cursor total: ${cursorCount})`);
        cursorToken = response.meta?.next_token;
        if (!cursorToken) break;
      }
    }

    const totalApiCalls = apiCalls + cursorApiCalls;
    const totalCount = count + cursorCount;

    if (cursorCount > 0) {
      console.log(`[count] Fresh: ${count}, From cursor: ${cursorCount}, Total: ${totalCount}`);
    }

    return { count: totalCount, apiCalls: totalApiCalls };
  }

  async fetchBookmarks(options: BookmarkFetchOptions): Promise<BookmarkFetchResult> {
    const token = await getActiveXToken();
    if (!token) {
      throw new Error("X account is not connected. Use /api/auth/x/start first.");
    }

    const totalLimit = Math.max(1, options.limit);
    const pageSize = Math.max(1, Math.min(100, totalLimit));
    const maxPages = 1;

    const bookmarks: BookmarkInput[] = [];
    let pageCount = 0;
    let nextToken: string | undefined = options.cursor;
    let stoppedReason: BookmarkFetchResult["stoppedReason"];

    while (bookmarks.length < totalLimit && pageCount < maxPages) {
      const remaining = totalLimit - bookmarks.length;
      const requestedPageSize = Math.max(1, Math.min(pageSize, remaining));
      const params = new URLSearchParams({
        max_results: String(requestedPageSize),
        "tweet.fields": "created_at,author_id,attachments,entities,note_tweet",
        expansions: "author_id,attachments.media_keys",
        "user.fields": "name,username",
        "media.fields": "type,url,preview_image_url,alt_text"
      });
      if (nextToken) {
        params.set("pagination_token", nextToken);
      }

      const requestCursor = nextToken;
      let response: XCollectionResponse;
      try {
        response = await fetchFromX<XCollectionResponse>(
          `/2/users/${token.userId}/bookmarks?${params.toString()}`,
          token.accessToken
        );
      } catch (error) {
        if (isRateLimitError(error)) {
          stoppedReason = "rate_limit";
          nextToken = requestCursor;
          break;
        }

        if (isCreditsDepletedError(error)) {
          stoppedReason = "credits_depleted";
          nextToken = requestCursor;
          break;
        }

        if (!isBadRequestError(error) || requestedPageSize >= 5) {
          throw error;
        }

        params.set("max_results", "5");
        try {
          response = await fetchFromX<XCollectionResponse>(
            `/2/users/${token.userId}/bookmarks?${params.toString()}`,
            token.accessToken
          );
        } catch (retryError) {
          if (isRateLimitError(retryError)) {
            stoppedReason = "rate_limit";
            nextToken = requestCursor;
            break;
          }

          if (isCreditsDepletedError(retryError)) {
            stoppedReason = "credits_depleted";
            nextToken = requestCursor;
            break;
          }
          throw retryError;
        }
      }

      const usersById = new Map((response.includes?.users ?? []).map((user) => [user.id, user]));
      const mediaByKey = new Map(
        (response.includes?.media ?? [])
          .filter((media): media is XMedia & { media_key: string } => Boolean(media.media_key))
          .map((media) => [media.media_key, media])
      );
      const pageBookmarks = (response.data ?? []).map((tweet) =>
        normalizeTweet(tweet, usersById, mediaByKey)
      );

      if (options.sinceDate) {
        for (const bm of pageBookmarks) {
          if (bm.bookmarkedAt < options.sinceDate) {
            stoppedReason = "date_cutoff";
            nextToken = undefined;
            break;
          }
          bookmarks.push(bm);
        }
        if (stoppedReason === "date_cutoff") {
          break;
        }
      } else {
        bookmarks.push(...pageBookmarks);
      }
      pageCount += 1;
      nextToken = response.meta?.next_token;
      if (!nextToken) {
        break;
      }
    }

    return {
      bookmarks: bookmarks.slice(0, totalLimit),
      nextCursor: nextToken,
      stoppedReason
    };
  }
}

export function createXClient(): XClient {
  if (appConfig.useMockX) {
    return new MockXClient();
  }

  return new OfficialXClient();
}
