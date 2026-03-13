import { prisma } from "@/lib/db/prisma";

export const OPENCLAW_WORKSPACE = "openclaw_workspace";
const SYNC_LOCK_KEY = "sync_lock";
const CLASSIFICATION_LOCK_KEY = "classification_lock";
const SYNC_LOCK_STALE_MS = 10 * 60 * 1000; // 10 minutes
const BUCKET_AUDIENCE_PREFIX = "bucket_audience:";
const BUCKET_TIER_PREFIX = "bucket_tier:";
const ONBOARDING_STARTED_AT_KEY = "onboarding_started_at";
const ONBOARDING_COMPLETED_AT_KEY = "onboarding_completed_at";
const LAST_ONBOARDING_DRAFT_AT_KEY = "last_onboarding_draft_at";

export type BucketAudience = "UNDECIDED" | "AGENT" | "PERSONAL";
export type BucketTier = "SUGGESTED" | "REAL";
export type BucketOnboardingState = {
  startedAt: string | null;
  completedAt: string | null;
  lastDraftAt: string | null;
};

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value }
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
}

function bucketAudienceKey(bucketId: string): string {
  return `${BUCKET_AUDIENCE_PREFIX}${bucketId}`;
}

function bucketTierKey(bucketId: string): string {
  return `${BUCKET_TIER_PREFIX}${bucketId}`;
}

export async function getBucketAudience(bucketId: string): Promise<BucketAudience> {
  const value = await getSetting(bucketAudienceKey(bucketId));
  return value === "AGENT" || value === "PERSONAL" ? value : "UNDECIDED";
}

export async function getBucketAudienceMap(
  bucketIds: string[],
): Promise<Record<string, BucketAudience>> {
  if (bucketIds.length === 0) {
    return {};
  }

  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: bucketIds.map((bucketId) => bucketAudienceKey(bucketId)),
      },
    },
  });

  const map = Object.fromEntries(
    bucketIds.map((bucketId) => [bucketId, "UNDECIDED" as BucketAudience]),
  );

  for (const row of rows) {
    const bucketId = row.key.slice(BUCKET_AUDIENCE_PREFIX.length);
    map[bucketId] =
      row.value === "AGENT" || row.value === "PERSONAL"
        ? row.value
        : "UNDECIDED";
  }

  return map;
}

export async function setBucketAudience(
  bucketId: string,
  audience: BucketAudience,
): Promise<void> {
  await setSetting(bucketAudienceKey(bucketId), audience);
}

export async function setBucketAudiences(
  updates: Array<{ bucketId: string; audience: BucketAudience }>,
): Promise<void> {
  await Promise.all(
    updates.map(({ bucketId, audience }) =>
      setSetting(bucketAudienceKey(bucketId), audience),
    ),
  );
}

export async function clearBucketAudienceSettings(): Promise<void> {
  await prisma.setting.deleteMany({
    where: {
      key: {
        startsWith: BUCKET_AUDIENCE_PREFIX,
      },
    },
  });
}

export async function getBucketTier(bucketId: string): Promise<BucketTier> {
  const value = await getSetting(bucketTierKey(bucketId));
  return value === "REAL" ? "REAL" : "SUGGESTED";
}

export async function getBucketTierMap(
  bucketIds: string[],
): Promise<Record<string, BucketTier>> {
  if (bucketIds.length === 0) {
    return {};
  }

  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: bucketIds.map((bucketId) => bucketTierKey(bucketId)),
      },
    },
  });

  const map = Object.fromEntries(
    bucketIds.map((bucketId) => [bucketId, "SUGGESTED" as BucketTier]),
  );

  for (const row of rows) {
    const bucketId = row.key.slice(BUCKET_TIER_PREFIX.length);
    map[bucketId] = row.value === "REAL" ? "REAL" : "SUGGESTED";
  }

  return map;
}

export async function setBucketTier(
  bucketId: string,
  tier: BucketTier,
): Promise<void> {
  await setSetting(bucketTierKey(bucketId), tier);
}

export async function setBucketTiers(
  updates: Array<{ bucketId: string; tier: BucketTier }>,
): Promise<void> {
  await Promise.all(
    updates.map(({ bucketId, tier }) => setSetting(bucketTierKey(bucketId), tier)),
  );
}

export async function clearBucketTierSettings(): Promise<void> {
  await prisma.setting.deleteMany({
    where: {
      key: {
        startsWith: BUCKET_TIER_PREFIX,
      },
    },
  });
}

function normalizeTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function getBucketOnboardingState(): Promise<BucketOnboardingState> {
  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: [
          ONBOARDING_STARTED_AT_KEY,
          ONBOARDING_COMPLETED_AT_KEY,
          LAST_ONBOARDING_DRAFT_AT_KEY,
        ],
      },
    },
  });

  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return {
    startedAt: normalizeTimestamp(map[ONBOARDING_STARTED_AT_KEY] ?? null),
    completedAt: normalizeTimestamp(map[ONBOARDING_COMPLETED_AT_KEY] ?? null),
    lastDraftAt: normalizeTimestamp(map[LAST_ONBOARDING_DRAFT_AT_KEY] ?? null),
  };
}

export async function markBucketOnboardingStarted(
  date = new Date(),
): Promise<string> {
  const existing = normalizeTimestamp(await getSetting(ONBOARDING_STARTED_AT_KEY));
  if (existing) {
    return existing;
  }

  const value = date.toISOString();
  await setSetting(ONBOARDING_STARTED_AT_KEY, value);
  return value;
}

export async function touchBucketOnboardingDraft(
  date = new Date(),
): Promise<string> {
  await markBucketOnboardingStarted(date);
  const value = date.toISOString();
  await setSetting(LAST_ONBOARDING_DRAFT_AT_KEY, value);
  return value;
}

export async function markBucketOnboardingCompleted(
  date = new Date(),
): Promise<string> {
  await markBucketOnboardingStarted(date);
  const value = date.toISOString();
  await setSetting(ONBOARDING_COMPLETED_AT_KEY, value);
  return value;
}

export async function clearBucketOnboardingState(): Promise<void> {
  await prisma.setting.deleteMany({
    where: {
      key: {
        in: [
          ONBOARDING_STARTED_AT_KEY,
          ONBOARDING_COMPLETED_AT_KEY,
          LAST_ONBOARDING_DRAFT_AT_KEY,
        ],
      },
    },
  });
}

export async function getOpenclawWorkspace(): Promise<string> {
  const dbValue = await getSetting(OPENCLAW_WORKSPACE);
  if (dbValue) {
    return dbValue;
  }
  return process.env.OPENCLAW_WORKSPACE ?? "";
}

// --- Sync lock ---

type SyncLockPayload = {
  runId: string;
  acquiredAt: number;
};

type ClassificationLockPayload = {
  runId: string;
  acquiredAt: number;
};

export async function acquireSyncLock(runId: string): Promise<boolean> {
  const existing = await getSetting(SYNC_LOCK_KEY);
  if (existing) {
    try {
      const payload: SyncLockPayload = JSON.parse(existing);
      const age = Date.now() - payload.acquiredAt;
      if (age < SYNC_LOCK_STALE_MS) {
        return false; // Lock is still valid
      }
      // Lock is stale — steal it
    } catch {
      // Corrupt lock value — steal it
    }
  }

  await setSetting(
    SYNC_LOCK_KEY,
    JSON.stringify({ runId, acquiredAt: Date.now() } satisfies SyncLockPayload)
  );
  return true;
}

export async function releaseSyncLock(runId: string): Promise<void> {
  const existing = await getSetting(SYNC_LOCK_KEY);
  if (!existing) {
    return;
  }

  try {
    const payload: SyncLockPayload = JSON.parse(existing);
    if (payload.runId !== runId) {
      return; // Another run stole the lock — don't release it
    }
  } catch {
    // Corrupt — clear it
  }

  await deleteSetting(SYNC_LOCK_KEY);
}

export async function acquireClassificationLock(runId: string): Promise<boolean> {
  const existing = await getSetting(CLASSIFICATION_LOCK_KEY);
  if (existing) {
    try {
      const payload: ClassificationLockPayload = JSON.parse(existing);
      const age = Date.now() - payload.acquiredAt;
      if (age < SYNC_LOCK_STALE_MS) {
        return false;
      }
    } catch {
      // Corrupt lock value — steal it.
    }
  }

  await setSetting(
    CLASSIFICATION_LOCK_KEY,
    JSON.stringify({ runId, acquiredAt: Date.now() } satisfies ClassificationLockPayload),
  );
  return true;
}

export async function releaseClassificationLock(runId: string): Promise<void> {
  const existing = await getSetting(CLASSIFICATION_LOCK_KEY);
  if (!existing) {
    return;
  }

  try {
    const payload: ClassificationLockPayload = JSON.parse(existing);
    if (payload.runId !== runId) {
      return;
    }
  } catch {
    // Corrupt — clear it.
  }

  await deleteSetting(CLASSIFICATION_LOCK_KEY);
}
