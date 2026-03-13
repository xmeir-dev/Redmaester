import { NextResponse } from "next/server";
import { z } from "zod";

import { applyBucketOnboardingDrafts } from "@/lib/buckets/onboarding";

const draftSchema = z.object({
  id: z.string().min(1),
  bucketId: z.string().min(1).optional(),
  draftName: z.string().trim().min(1).max(120),
  draftDescription: z.string().trim().max(300),
  audience: z.enum(["UNDECIDED", "AGENT", "PERSONAL"]),
  tier: z.enum(["REAL", "SUGGESTED"]),
  action: z.enum(["PROMOTE", "MERGE", "CREATE", "KEEP_PERSONAL", "DEFER"]),
  mergeTargetBucketId: z.string().min(1).optional(),
  sampleBookmarkIds: z.array(z.string()).max(12),
  sampleBookmarks: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string(),
        authorHandle: z.string(),
        url: z.string(),
      }),
    )
    .max(12),
  reason: z.string().trim().min(1).max(400),
  origin: z.enum(["heuristic", "curator"]),
});

const bodySchema = z.object({
  drafts: z.array(draftSchema).min(1),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await applyBucketOnboardingDrafts(body.drafts);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to apply onboarding draft",
      },
      { status: 400 },
    );
  }
}
