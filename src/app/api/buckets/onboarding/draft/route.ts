import { NextResponse } from "next/server";

import { generateBucketOnboardingDrafts } from "@/lib/buckets/onboarding";

export async function POST(): Promise<NextResponse> {
  try {
    const result = await generateBucketOnboardingDrafts();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate onboarding draft",
      },
      { status: 500 },
    );
  }
}
