import type { BookmarkInput } from "@/lib/domain/types";

export type BookmarkFetchOptions = {
  limit: number;
  cursor?: string;
  sinceDate?: Date;
};

export type BookmarkFetchResult = {
  bookmarks: BookmarkInput[];
  nextCursor?: string;
  stoppedReason?: "rate_limit" | "credits_depleted" | "date_cutoff";
};
