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
  type: "skill" | "reference" | "unrelated";
  confidence: number;
  rationale: string;
  skillName?: string;
  suggestedSkillName?: string;
  matchedSkillName?: string;
  matchedSkillId?: string;
  extractedSkillContent?: string;
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
  processed: number;
  enriched: number;
  classified: number;
  skillsCreated: number;
  referencesAttached: number;
  triaged: number;
  blocked?: boolean;
  pendingCount?: number;
  estimatedCost?: number;
  budgetRemaining?: number;
  enrichmentWarning?: string;
};
