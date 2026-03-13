import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  clearBucketAudienceSettings,
  clearBucketOnboardingState,
  clearBucketTierSettings,
} from "@/lib/settings/service";
import { saveFullSyncCursor } from "@/lib/sync/sync-state";

export async function POST() {
  try {
    const { count } = await prisma.bookmark.deleteMany();
    await prisma.skill.deleteMany({
      where: {
        OR: [
          { source: "bookmark" },
          { source: "bucket" }
        ]
      }
    });
    await prisma.bucket.deleteMany();
    await clearBucketAudienceSettings();
    await clearBucketTierSettings();
    await clearBucketOnboardingState();
    await saveFullSyncCursor(undefined);
    return NextResponse.json({ ok: true, deletedCount: count });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear bookmarks" },
      { status: 500 },
    );
  }
}
