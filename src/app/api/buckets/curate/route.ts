import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createRealBucket,
  createRealBucketAndMerge,
  mergeBucketIntoTarget,
  moveBookmarksToBucket,
  promoteBucket,
} from "@/lib/buckets/curation";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_bucket"),
    displayName: z.string().trim().min(1).max(120),
    description: z.string().trim().max(300).optional(),
    audience: z.enum(["AGENT", "PERSONAL"]),
  }),
  z.object({
    action: z.literal("promote_bucket"),
    bucketId: z.string().min(1),
    audience: z.enum(["AGENT", "PERSONAL"]),
  }),
  z.object({
    action: z.literal("merge_buckets"),
    sourceBucketIds: z.array(z.string().min(1)).min(1).max(8),
    targetBucketId: z.string().min(1),
  }),
  z.object({
    action: z.literal("create_and_merge"),
    sourceBucketIds: z.array(z.string().min(1)).min(1).max(8),
    displayName: z.string().trim().min(1).max(120),
    description: z.string().trim().max(300).optional(),
    audience: z.enum(["AGENT", "PERSONAL"]),
  }),
  z.object({
    action: z.literal("move_bookmarks"),
    bookmarkIds: z.array(z.string().min(1)).min(1).max(40),
    targetBucketId: z.string().min(1),
  }),
]);

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));

    if (body.action === "create_bucket") {
      const bucket = await createRealBucket({
        displayName: body.displayName,
        description: body.description,
        audience: body.audience,
      });

      return NextResponse.json({
        ok: true,
        message: `Created real bucket ${bucket.displayName}.`,
      });
    }

    if (body.action === "promote_bucket") {
      const bucket = await promoteBucket({
        bucketId: body.bucketId,
        audience: body.audience,
      });

      return NextResponse.json({
        ok: true,
        message: `Promoted ${bucket.displayName} into a real bucket.`,
      });
    }

    if (body.action === "merge_buckets") {
      const results = [];
      for (const sourceBucketId of body.sourceBucketIds) {
        results.push(
          await mergeBucketIntoTarget({
            sourceBucketId,
            targetBucketId: body.targetBucketId,
          }),
        );
      }

      const totalBookmarks = results.reduce(
        (sum, result) => sum + result.movedBookmarks,
        0,
      );
      const totalMicroSkills = results.reduce(
        (sum, result) => sum + result.movedMicroSkills,
        0,
      );

      return NextResponse.json({
        ok: true,
        message: `Merged ${results.length} bucket${results.length === 1 ? "" : "s"} and moved ${totalBookmarks} bookmarks plus ${totalMicroSkills} micro-skills.`,
      });
    }

    if (body.action === "move_bookmarks") {
      const result = await moveBookmarksToBucket({
        bookmarkIds: body.bookmarkIds,
        targetBucketId: body.targetBucketId,
      });

      return NextResponse.json({
        ok: true,
        message:
          result.movedBookmarks === 0
            ? `Selected bookmarks were already in ${result.targetBucketName}.`
            : `Moved ${result.movedBookmarks} bookmark${result.movedBookmarks === 1 ? "" : "s"} to ${result.targetBucketName} and requeued them for classification.`,
      });
    }

    const bucket = await createRealBucketAndMerge({
      displayName: body.displayName,
      description: body.description,
      audience: body.audience,
      sourceBucketIds: body.sourceBucketIds,
    });

    return NextResponse.json({
      ok: true,
      message: `Created ${bucket.displayName} and merged ${body.sourceBucketIds.length} bucket${body.sourceBucketIds.length === 1 ? "" : "s"} into it.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to curate buckets",
      },
      { status: 400 },
    );
  }
}
