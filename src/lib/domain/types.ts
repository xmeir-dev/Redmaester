export type BookmarkInput = {
  id: string;
  text: string;
  authorHandle: string;
  authorName?: string;
  url: string;
  bookmarkedAt: Date;
  rawJson: unknown;
};

export type ModelUsageSnapshot = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
};

export type ClassificationOutput = {
  bucketName: string;
  bucketDisplayName: string;
  bucketDescription: string;
  roleType: "REFERENCE" | "MICRO_SKILL" | "IGNORE";
  confidence: number;
  rationale: string;
  microSkillName?: string;
  fallback: boolean;
  usage?: ModelUsageSnapshot;
};

export type EnrichmentResult = {
  totalUrls: number;
  successCount: number;
};

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  source: string;
  referenceCount: number;
  createdAt: Date;
};

export type PipelineResult = {
  discoveredCount: number;
  processed: number;
  enriched: number;
  classified: number;
  skillsCreated: number;
  referencesAttached: number;
  triaged: number;
  bucketsRefreshed?: number;
  blocked?: boolean;
  needsBucketReview?: boolean;
  discoveryPendingCount?: number;
  pendingCount?: number;
  queuedMicroSkillCount?: number;
  dirtyBucketCount?: number;
  undecidedBucketCount?: number;
  estimatedCost?: number;
  budgetRemaining?: number;
  enrichmentWarning?: string;
};
