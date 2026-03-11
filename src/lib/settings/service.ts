import { prisma } from "@/lib/db/prisma";

export const OPENCLAW_WORKSPACE = "openclaw_workspace";
const SYNC_LOCK_KEY = "sync_lock";
const SYNC_LOCK_STALE_MS = 10 * 60 * 1000; // 10 minutes

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
