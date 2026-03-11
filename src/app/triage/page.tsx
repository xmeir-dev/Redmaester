export const dynamic = "force-dynamic";

import { AppShell } from "@/components/app-shell";
import { TriageList } from "@/components/triage-list";
import { getTriageData } from "@/lib/domain/queries";
import { prisma } from "@/lib/db/prisma";

export default async function TriagePage() {
  const triageItems = await getTriageData();

  // Fetch classification data for skill_review items
  const bookmarkIds = triageItems
    .filter((item) => item.reason === "skill_review")
    .map((item) => item.tweetId);

  const classifications = bookmarkIds.length > 0
    ? await prisma.bookmarkClassification.findMany({
        where: { bookmarkId: { in: bookmarkIds } },
        select: {
          bookmarkId: true,
          extractedSkillName: true,
          extractedSkillContent: true
        }
      })
    : [];

  const classificationMap = new Map(
    classifications.map((c) => [c.bookmarkId, c])
  );

  const items = triageItems.map((item) => {
    const classification = classificationMap.get(item.tweetId);
    return {
      id: item.id,
      tweetId: item.tweetId,
      reason: item.reason,
      details: item.details,
      bookmarkText: item.bookmark.text,
      authorHandle: item.bookmark.authorHandle,
      extractedSkillName: classification?.extractedSkillName ?? null,
      extractedSkillContent: classification?.extractedSkillContent ?? null
    };
  });

  return (
    <AppShell>
      <section className="panel">
        <h2>Open Items</h2>
        <TriageList items={items} />
      </section>
    </AppShell>
  );
}
