import { SyncMode } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { runSync } from "@/lib/sync/sync-service";

const bodySchema = z.object({
  mode: z.nativeEnum(SyncMode).default(SyncMode.AUTO),
  limit: z.number().int().positive().optional(),
  sinceDays: z.number().int().positive().optional()
});

export async function POST(request: Request) {
  try {
    const payload = bodySchema.parse(await request.json().catch(() => ({})));
    const sinceDate = payload.sinceDays
      ? new Date(Date.now() - payload.sinceDays * 24 * 60 * 60 * 1000)
      : undefined;
    const result = await runSync(payload.mode, { limit: payload.limit, sinceDate });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Sync failed"
      },
      { status: 500 }
    );
  }
}
