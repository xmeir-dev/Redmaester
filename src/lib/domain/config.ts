function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseUnlimited(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return parsed;
}

function parseScopes(value: string | undefined): string[] {
  if (!value) {
    return ["tweet.read", "users.read", "bookmark.read", "offline.access"];
  }

  return value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export const appConfig = {
  monthlyBudgetUsd: parseNumber(process.env.MONTHLY_BUDGET_USD, 30),
  estimatedRouteCostUsd: parseNumber(process.env.ESTIMATED_ROUTE_COST_USD, 0.005),
  autoSyncIntervalMinutes: parseNumber(process.env.AUTO_SYNC_INTERVAL_MINUTES, 5),
  initialSyncDefaultLimit: parseUnlimited(process.env.INITIAL_SYNC_DEFAULT_LIMIT, 500),
  backfillChunkLimit: parseUnlimited(process.env.BACKFILL_CHUNK_LIMIT, 500),
  autoSyncLookbackLimit: parseUnlimited(process.env.AUTO_SYNC_LOOKBACK_LIMIT, 500),
  fullSyncPageSize: parseNumber(process.env.FULL_SYNC_PAGE_SIZE, 50),
  fullSyncMaxPages: parseUnlimited(process.env.FULL_SYNC_MAX_PAGES, 20),
  fullSyncMaxBookmarks: parseUnlimited(process.env.FULL_SYNC_MAX_BOOKMARKS, 1000),
  routingConfidenceThreshold: parseNumber(process.env.ROUTING_CONFIDENCE_THRESHOLD, 0.65),
  routingModelTimeoutMs: parseNumber(process.env.ROUTING_MODEL_TIMEOUT_MS, 5000),
  routingModel: process.env.ROUTING_MODEL ?? "claude-sonnet-4-6",
  bookmarkClassificationModel:
    process.env.BOOKMARK_CLASSIFICATION_MODEL ?? "claude-3-haiku-20240307",
  microSkillModel: process.env.MICRO_SKILL_MODEL ?? "claude-sonnet-4-6",
  masterSkillModel: process.env.MASTER_SKILL_MODEL ?? "claude-sonnet-4-6",
  chatModelTimeoutMs: parseNumber(process.env.CHAT_MODEL_TIMEOUT_MS, 60000),
  chatModel: process.env.CHAT_MODEL ?? process.env.ROUTING_MODEL ?? "claude-sonnet-4-6",
  chatEvidenceLimit: parseNumber(process.env.CHAT_EVIDENCE_LIMIT, 220),
  chatChunkSize: parseNumber(process.env.CHAT_CHUNK_SIZE, 24),
  chatMaxChunks: parseNumber(process.env.CHAT_MAX_CHUNKS, 4),
  useMockX: (process.env.USE_MOCK_X ?? "true").toLowerCase() === "true",
  xApiBaseUrl: process.env.X_API_BASE_URL ?? "https://api.x.com",
  xClientId: process.env.X_CLIENT_ID ?? "",
  xClientSecret: process.env.X_CLIENT_SECRET ?? "",
  xRedirectUri: process.env.X_REDIRECT_URI ?? "http://localhost:3000/api/auth/x/callback",
  xOauthScopes: parseScopes(process.env.X_OAUTH_SCOPES),
  xDefaultUserId: process.env.X_DEFAULT_USER_ID ?? "",
  classificationAutoCreateThreshold: parseNumber(process.env.CLASSIFICATION_AUTO_CREATE_THRESHOLD, 0.85),
  classificationReviewThreshold: parseNumber(process.env.CLASSIFICATION_REVIEW_THRESHOLD, 0.40),
  classificationReferenceThreshold: parseNumber(process.env.CLASSIFICATION_REFERENCE_THRESHOLD, 0.50),
  estimatedClassificationCostUsd: parseNumber(process.env.ESTIMATED_CLASSIFICATION_COST_USD, 0.03),
  estimatedMicroSkillCostUsd: parseNumber(process.env.ESTIMATED_MICRO_SKILL_COST_USD, 0.08),
  estimatedMasterSkillCostUsd: parseNumber(process.env.ESTIMATED_MASTER_SKILL_COST_USD, 0.12),
  enrichmentFetchTimeoutMs: parseNumber(process.env.ENRICHMENT_FETCH_TIMEOUT_MS, 10000),
  enrichmentMaxUrls: parseNumber(process.env.ENRICHMENT_MAX_URLS, 5),
  playwrightTimeoutMs: parseNumber(process.env.PLAYWRIGHT_TIMEOUT_MS, 30000),
  browserbaseApiKey: process.env.BROWSERBASE_API_KEY ?? "",
  browserbaseProjectId: process.env.BROWSERBASE_PROJECT_ID ?? "",
  browserbaseContextId: process.env.BROWSERBASE_CONTEXT_ID ?? "",
  enableKeychainAccess: (process.env.ENABLE_KEYCHAIN_ACCESS ?? "false").toLowerCase() === "true",
};

export function currentMonthKey(date = new Date()): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}
