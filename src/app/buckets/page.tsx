export const dynamic = "force-dynamic";

import { AppShell } from "@/components/app-shell";
import { BucketOnboardingWizard } from "@/components/bucket-onboarding-wizard";
import { BucketsList } from "@/components/buckets-list";
import { getBucketsData } from "@/lib/domain/queries";

export default async function BucketsPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string; advanced?: string }>;
}) {
  const params = await searchParams;
  const data = await getBucketsData();
  const forceOnboarding = params.onboarding === "1";
  const forceAdvanced = params.advanced === "1";
  const showOnboarding =
    !forceAdvanced && (forceOnboarding || data.onboarding.needsOnboarding);

  return (
    <AppShell>
      <section className="panel">
        <h2>{showOnboarding ? "Guided Bucket Setup" : "Buckets"}</h2>
        {showOnboarding ? (
          <BucketOnboardingWizard
            buckets={data.buckets}
            onboarding={data.onboarding}
          />
        ) : (
          <BucketsList
            buckets={data.buckets}
            initialSuggestions={data.suggestions}
            onboarding={false}
            undecidedBucketCount={data.undecidedBucketCount}
          />
        )}
      </section>
    </AppShell>
  );
}
