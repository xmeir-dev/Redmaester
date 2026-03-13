import { SyncMode, SyncStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { BookmarkInput } from "@/lib/domain/types";
import { loadSyncState, saveFullSyncCursor } from "@/lib/sync/sync-state";
import { createXClient } from "@/lib/sync/x-client";
import { appConfig } from "@/lib/domain/config";
import { acquireSyncLock, releaseSyncLock } from "@/lib/settings/service";

type SyncSummary = {
  runId: string;
  requestedMode: SyncMode;
  effectiveMode: SyncMode;
  newBookmarks: number;
  triagedCount: number;
  knownTweetEncountered: boolean;
  notes?: string | null;
};

function serializeRawJson(rawJson: unknown): string {
  try {
    return JSON.stringify(rawJson ?? {});
  } catch {
    return "{}";
  }
}

async function persistBookmark(bookmark: BookmarkInput): Promise<boolean> {
  const existing = await prisma.bookmark.findUnique({
    where: { id: bookmark.id },
    select: { id: true }
  });

  if (existing) {
    await prisma.bookmark.update({
      where: { id: bookmark.id },
      data: {
        text: bookmark.text,
        authorHandle: bookmark.authorHandle,
        authorName: bookmark.authorName,
        url: bookmark.url,
        rawJson: serializeRawJson(bookmark.rawJson),
        bookmarkedAt: bookmark.bookmarkedAt,
        syncedAt: new Date()
      }
    });
    return false;
  }

  await prisma.bookmark.create({
    data: {
      id: bookmark.id,
      text: bookmark.text,
      authorHandle: bookmark.authorHandle,
      authorName: bookmark.authorName,
      url: bookmark.url,
      rawJson: serializeRawJson(bookmark.rawJson),
      bookmarkedAt: bookmark.bookmarkedAt
    }
  });

  return true;
}

export async function runSync(requestedMode: SyncMode, options?: { limit?: number; sinceDate?: Date }): Promise<SyncSummary> {
  const xClient = createXClient();
  const bookmarkCount = await prisma.bookmark.count();

  const effectiveMode =
    requestedMode === SyncMode.AUTO && bookmarkCount === 0 ? SyncMode.FULL : requestedMode;

  const syncRun = await prisma.syncRun.create({
    data: {
      mode: effectiveMode,
      status: SyncStatus.SUCCESS,
      notes:
        requestedMode !== effectiveMode
          ? "Auto sync switched to full sync because bookmark table was empty."
          : null
    }
  });

  // Acquire sync lock
  const lockAcquired = await acquireSyncLock(syncRun.id);
  if (!lockAcquired) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: SyncStatus.FAILED,
        notes: "Another sync is already in progress",
        finishedAt: new Date()
      }
    });
    return {
      runId: syncRun.id,
      requestedMode,
      effectiveMode,
      newBookmarks: 0,
      triagedCount: 0,
      knownTweetEncountered: false,
      notes: "Another sync is already in progress"
    };
  }

  let newBookmarks = 0;
  let triagedCount = 0;
  let knownTweetEncountered = false;
  let runNotes: string | null = syncRun.notes;

  try {
    const state = effectiveMode === SyncMode.FULL ? await loadSyncState() : {};
    const hasExplicitLimit = Boolean(options?.limit);
    let limit: number;
    let cursor: string | undefined;

    if (effectiveMode === SyncMode.AUTO) {
      limit = options?.limit ?? appConfig.autoSyncLookbackLimit;
    } else if (hasExplicitLimit) {
      limit = options!.limit!;
    } else if (bookmarkCount === 0) {
      limit = appConfig.initialSyncDefaultLimit;
      runNotes = `Initial import capped to the latest ${limit.toLocaleString()} bookmarks for cost control.`;
    } else if (state.fullSyncCursor) {
      limit = appConfig.backfillChunkLimit;
      cursor = state.fullSyncCursor;
      runNotes = `Backfilling older bookmarks in chunks of ${limit.toLocaleString()}.`;
    } else {
      await prisma.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: SyncStatus.SUCCESS,
          notes: "Older bookmark backfill is already complete.",
          finishedAt: new Date()
        }
      });

      return {
        runId: syncRun.id,
        requestedMode,
        effectiveMode,
        newBookmarks: 0,
        triagedCount: 0,
        knownTweetEncountered: false,
        notes: "Older bookmark backfill is already complete."
      };
    }

    const fetchResult = await xClient.fetchBookmarks({
      limit,
      cursor: effectiveMode === SyncMode.FULL && !hasExplicitLimit ? cursor : undefined,
      sinceDate: options?.sinceDate
    });
    const batch = fetchResult.bookmarks;

    if (effectiveMode === SyncMode.FULL) {
      await saveFullSyncCursor(fetchResult.nextCursor);
      if (fetchResult.stoppedReason === "date_cutoff") {
        runNotes = "Stopped at date cutoff. All bookmarks within the requested range were synced.";
      } else if (fetchResult.stoppedReason === "credits_depleted") {
        runNotes = "Stopped at X credits limit. Cursor saved for next full sync.";
      } else if (fetchResult.stoppedReason === "rate_limit") {
        runNotes = "Stopped at X rate limit. Cursor saved for next full sync.";
      } else if (!fetchResult.nextCursor) {
        runNotes = bookmarkCount === 0
          ? "Initial import reached the end of available bookmark history."
          : "Older bookmark backfill reached the end of bookmark history.";
      }
    }

    for (const bookmark of batch) {
      const isNew = await persistBookmark(bookmark);

      if (!isNew) {
        if (effectiveMode === SyncMode.AUTO) {
          knownTweetEncountered = true;
          break;
        }
        continue;
      }

      newBookmarks += 1;
    }

    const finalNotes =
      knownTweetEncountered && effectiveMode === SyncMode.AUTO
        ? "Auto sync stopped at first known bookmark."
        : runNotes;

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: SyncStatus.SUCCESS,
        newBookmarks,
        triagedCount,
        notes: finalNotes,
        finishedAt: new Date()
      }
    });

    return {
      runId: syncRun.id,
      requestedMode,
      effectiveMode,
      newBookmarks,
      triagedCount,
      knownTweetEncountered,
      notes: finalNotes
    };
  } catch (error) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: SyncStatus.FAILED,
        notes: error instanceof Error ? error.message : "Unknown sync error",
        finishedAt: new Date()
      }
    });
    throw error;
  } finally {
    await releaseSyncLock(syncRun.id);
  }
}
