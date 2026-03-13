import type { BookmarkInput } from "@/lib/domain/types";
import { appConfig } from "@/lib/domain/config";
import { getActiveXToken } from "@/lib/auth/token-store";
import { mockBookmarks } from "@/lib/sync/mock-bookmarks";
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
    result_count?: number;
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

type FullSyncCursorState = {
  version: 1;
  mainCursor?: string;
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

function tweetFieldsParams(): Record<string, string> {
  return {
    "tweet.fields": "created_at,author_id,attachments,entities,note_tweet",
    expansions: "author_id,attachments.media_keys",
    "user.fields": "name,username",
    "media.fields": "type,url,preview_image_url,alt_text"
  };
}

function parseFullSyncCursor(cursor: string | undefined): FullSyncCursorState {
  if (!cursor) {
    return { version: 1 };
  }

  try {
    const parsed = JSON.parse(cursor) as Partial<FullSyncCursorState>;
    if (parsed && parsed.version === 1) {
      return {
        version: 1,
        mainCursor: parsed.mainCursor || undefined
      };
    }
  } catch {
    // Backward compatibility for older string-only cursors.
  }

  return {
    version: 1,
    mainCursor: cursor
  };
}

function serializeFullSyncCursor(state: FullSyncCursorState): string | undefined {
  if (!state.mainCursor) {
    return undefined;
  }

  return JSON.stringify({
    version: 1,
    mainCursor: state.mainCursor
  });
}

function normalizeTweets(response: XCollectionResponse): BookmarkInput[] {
  const usersById = new Map((response.includes?.users ?? []).map((user) => [user.id, user]));
  const mediaByKey = new Map(
    (response.includes?.media ?? [])
      .filter((media): media is XMedia & { media_key: string } => Boolean(media.media_key))
      .map((media) => [media.media_key, media])
  );

  return (response.data ?? []).map((tweet) => normalizeTweet(tweet, usersById, mediaByKey));
}

async function fetchTopLevelBookmarkPage(input: {
  accessToken: string;
  userId: string;
  limit: number;
  cursor?: string;
}): Promise<XCollectionResponse> {
  const params = new URLSearchParams({
    max_results: String(input.limit),
    ...tweetFieldsParams()
  });
  if (input.cursor) {
    params.set("pagination_token", input.cursor);
  }

  return fetchFromX<XCollectionResponse>(
    `/2/users/${input.userId}/bookmarks?${params.toString()}`,
    input.accessToken
  );
}

function mergeUniqueBookmarks(
  target: BookmarkInput[],
  incoming: BookmarkInput[],
  seenIds: Set<string>,
  limit: number,
  sinceDate?: Date
): void {
  for (const bookmark of incoming) {
    if (sinceDate && bookmark.bookmarkedAt < sinceDate) {
      continue;
    }

    if (seenIds.has(bookmark.id)) {
      continue;
    }

    seenIds.add(bookmark.id);
    target.push(bookmark);
    if (target.length >= limit) {
      break;
    }
  }
}

class OfficialXClient implements XClient {
  async countBookmarks(): Promise<BookmarkCountResult> {
    const token = await getActiveXToken();
    if (!token) {
      throw new Error("X account is not connected. Use /api/auth/x/start first.");
    }

    // X drops pagination for some accounts when max_results approaches 100.
    const pageSize = Math.max(5, Math.min(90, appConfig.fullSyncPageSize));
    const seenIds = new Set<string>();
    let apiCalls = 0;
    let nextToken: string | undefined;
    while (apiCalls < 500) {
      let response: XCollectionResponse;
      try {
        response = await fetchTopLevelBookmarkPage({
          accessToken: token.accessToken,
          userId: token.userId,
          limit: pageSize,
          cursor: nextToken
        });
        apiCalls++;
      } catch (error) {
        if (isRateLimitError(error)) {
          return { count: seenIds.size, apiCalls, stoppedReason: "rate_limit" };
        }
        if (isCreditsDepletedError(error)) {
          return { count: seenIds.size, apiCalls, stoppedReason: "credits_depleted" };
        }
        throw error;
      }

      for (const bookmark of normalizeTweets(response)) {
        seenIds.add(bookmark.id);
      }
      nextToken = response.meta?.next_token;
      if (!nextToken) {
        break;
      }
    }

    return { count: seenIds.size, apiCalls };
  }

  async fetchBookmarks(options: BookmarkFetchOptions): Promise<BookmarkFetchResult> {
    const token = await getActiveXToken();
    if (!token) {
      throw new Error("X account is not connected. Use /api/auth/x/start first.");
    }

    const totalLimit = Math.max(1, options.limit);
    // X drops pagination for some accounts when max_results approaches 100.
    const configuredPageSize = Math.min(appConfig.fullSyncPageSize, totalLimit);
    const pageSize = Math.max(1, Math.min(90, configuredPageSize));
    const maxPages = appConfig.fullSyncMaxPages > 0 ? appConfig.fullSyncMaxPages : Infinity;
    const seenIds = new Set<string>();
    const bookmarks: BookmarkInput[] = [];
    let pageCount = 0;
    const cursorState = parseFullSyncCursor(options.cursor);
    let nextToken: string | undefined = cursorState.mainCursor;
    let stoppedReason: BookmarkFetchResult["stoppedReason"];

    while (bookmarks.length < totalLimit && pageCount < maxPages) {
      const remaining = totalLimit - bookmarks.length;
      const requestedPageSize = Math.max(1, Math.min(pageSize, remaining));
      const requestCursor = nextToken;
      let response: XCollectionResponse;
      try {
        response = await fetchTopLevelBookmarkPage({
          accessToken: token.accessToken,
          userId: token.userId,
          limit: requestedPageSize,
          cursor: nextToken
        });
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

        try {
          response = await fetchTopLevelBookmarkPage({
            accessToken: token.accessToken,
            userId: token.userId,
            limit: 5,
            cursor: nextToken
          });
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

      const pageBookmarks = normalizeTweets(response);

      if (options.sinceDate) {
        for (const bm of pageBookmarks) {
          if (bm.bookmarkedAt < options.sinceDate) {
            stoppedReason = "date_cutoff";
            nextToken = undefined;
            break;
          }
          mergeUniqueBookmarks(bookmarks, [bm], seenIds, totalLimit, options.sinceDate);
        }
        if (stoppedReason === "date_cutoff") {
          break;
        }
      } else {
        mergeUniqueBookmarks(bookmarks, pageBookmarks, seenIds, totalLimit);
      }
      pageCount += 1;
      nextToken = response.meta?.next_token;
      if (!nextToken) {
        break;
      }
    }

    bookmarks.sort((a, b) => b.bookmarkedAt.getTime() - a.bookmarkedAt.getTime());

    return {
      bookmarks: bookmarks.slice(0, totalLimit),
      nextCursor: serializeFullSyncCursor({ version: 1, mainCursor: nextToken }),
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
