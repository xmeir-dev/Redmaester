import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import {
  setBucketAudiences,
  setBucketTiers,
  type BucketAudience,
  type BucketTier,
} from "@/lib/settings/service";

const bodySchema = z.object({
  updates: z
    .array(
      z.object({
        bucketId: z.string().min(1),
        tier: z.enum(["SUGGESTED", "REAL"]),
        audience: z.enum(["UNDECIDED", "AGENT", "PERSONAL"]).optional(),
        displayName: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().min(1).max(300).optional(),
      }),
    )
    .min(1),
});

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const body = bodySchema.parse(await request.json());
    const bucketIds = body.updates.map((update) => update.bucketId);

    const existingCount = await prisma.bucket.count({
      where: { id: { in: bucketIds } },
    });

    if (existingCount !== bucketIds.length) {
      return NextResponse.json(
        { error: "One or more buckets do not exist" },
        { status: 400 },
      );
    }

    await Promise.all([
      setBucketTiers(
        body.updates.map((update) => ({
          bucketId: update.bucketId,
          tier: update.tier as BucketTier,
        })),
      ),
      setBucketAudiences(
        body.updates.map((update) => ({
          bucketId: update.bucketId,
          audience:
            update.tier === "REAL"
              ? ((update.audience ?? "UNDECIDED") as BucketAudience)
              : "UNDECIDED",
        })),
      ),
      ...body.updates.map((update) =>
        prisma.bucket.update({
          where: { id: update.bucketId },
          data: {
            ...(update.displayName ? { displayName: update.displayName } : {}),
            ...(update.description ? { description: update.description } : {}),
          },
        }),
      ),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save bucket preferences",
      },
      { status: 500 },
    );
  }
}
