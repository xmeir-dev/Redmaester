export const dynamic = "force-dynamic";

import { AppShell } from "@/components/app-shell";
import { LogsTabs } from "@/components/logs-tabs";
import { getLogsData } from "@/lib/domain/queries";

export default async function LogsPage() {
  const data = await getLogsData();

  return (
    <AppShell>
      <LogsTabs recentRuns={data.recentRuns} recentClassifications={data.recentClassifications} />
    </AppShell>
  );
}
