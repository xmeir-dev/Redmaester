import { NextResponse } from "next/server";

import { getOpenclawWorkspace } from "@/lib/settings/service";
import { syncSkillsBidirectional } from "@/lib/openclaw/sync-service";

export async function POST(): Promise<NextResponse> {
  try {
    const workspace = await getOpenclawWorkspace();
    if (!workspace) {
      return NextResponse.json(
        { error: "OpenClaw workspace not configured" },
        { status: 400 }
      );
    }

    const result = await syncSkillsBidirectional(workspace);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
