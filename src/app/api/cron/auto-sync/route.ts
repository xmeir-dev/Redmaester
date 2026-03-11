import { SyncMode } from "@prisma/client";
import { NextResponse } from "next/server";

import { runClassificationPipeline } from "@/lib/classification/pipeline";
import { runSync } from "@/lib/sync/sync-service";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const syncResult = await runSync(SyncMode.AUTO);
    const classifyResult = await runClassificationPipeline();
    return NextResponse.json({ ok: true, sync: syncResult, classification: classifyResult });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Auto-sync failed" },
      { status: 500 }
    );
  }
}
