import type { BucketAudience } from "@/lib/settings/service";

export type BucketCurationSuggestionAction =
  | "PROMOTE_BUCKET"
  | "MERGE_BUCKET_INTO"
  | "CREATE_REAL_BUCKET"
  | "CREATE_AND_MERGE";

export type BucketCurationSuggestionOrigin = "heuristic" | "curator";

export type BucketCurationSuggestion = {
  id: string;
  action: BucketCurationSuggestionAction;
  origin: BucketCurationSuggestionOrigin;
  title: string;
  reason: string;
  sourceBucketIds: string[];
  sourceBucketNames: string[];
  targetBucketId?: string;
  targetDisplayName?: string;
  targetDescription?: string;
  audience?: BucketAudience;
  preview: {
    bookmarkCount: number;
    microSkillCount: number;
  };
};

export type BucketCurationBucket = {
  id: string;
  displayName: string;
  description: string;
  tier: "SUGGESTED" | "REAL";
  audience: "UNDECIDED" | "AGENT" | "PERSONAL";
  bookmarkCount: number;
  microSkillCount: number;
};

export type BucketOnboardingDraftAction =
  | "PROMOTE"
  | "MERGE"
  | "CREATE"
  | "KEEP_PERSONAL"
  | "DEFER";

export type BucketOnboardingBookmarkSample = {
  id: string;
  text: string;
  authorHandle: string;
  url: string;
};

export type BucketOnboardingDraft = {
  id: string;
  bucketId?: string;
  draftName: string;
  draftDescription: string;
  audience: BucketAudience;
  tier: "REAL" | "SUGGESTED";
  action: BucketOnboardingDraftAction;
  mergeTargetBucketId?: string;
  sampleBookmarkIds: string[];
  sampleBookmarks: BucketOnboardingBookmarkSample[];
  reason: string;
  origin: BucketCurationSuggestionOrigin;
};
