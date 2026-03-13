import { NextResponse } from "next/server";
import { z } from "zod";

import { suggestBucketActions } from "@/lib/buckets/curation";

const bodySchema = z.object({
  instruction: z.string().trim().min(1).max(1200),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await suggestBucketActions(body.instruction);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to get curator suggestions",
      },
      { status: 400 },
    );
  }
}
