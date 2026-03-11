import { NextResponse } from "next/server";

import {
  getOpenclawWorkspace,
  OPENCLAW_WORKSPACE,
  setSetting
} from "@/lib/settings/service";
import { validateWorkspacePath } from "@/lib/openclaw/filesystem";
import { importSkillsFromFilesystem } from "@/lib/openclaw/sync-service";

export async function GET(): Promise<NextResponse> {
  const workspace = await getOpenclawWorkspace();

  return NextResponse.json({
    openclawWorkspace: workspace || null,
    openclawConnected: !!workspace,
    firecrawlAvailable: !!process.env.X402_WALLET_PATH
  });
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { openclawWorkspace?: string };
    const workspace = body.openclawWorkspace;

    if (!workspace) {
      return NextResponse.json(
        { error: "openclawWorkspace is required" },
        { status: 400 }
      );
    }

    const validation = await validateWorkspacePath(workspace);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    await setSetting(OPENCLAW_WORKSPACE, workspace);

    // Trigger initial import
    const importResult = await importSkillsFromFilesystem(workspace);

    return NextResponse.json({
      ok: true,
      openclawWorkspace: workspace,
      import: importResult
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Settings update failed" },
      { status: 500 }
    );
  }
}
