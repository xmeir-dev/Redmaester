import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTriage } from "@/lib/triage/service";

const bodySchema = z.object({
  triageId: z.string().min(1),
  skillName: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const payload = bodySchema.parse(await request.json());
    await resolveTriage(payload.triageId, payload.skillName);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to resolve triage item" },
      { status: 400 }
    );
  }
}
