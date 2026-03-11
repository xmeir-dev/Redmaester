export const dynamic = "force-dynamic";

import { AppShell } from "@/components/app-shell";
import { SkillsList } from "@/components/skills-list";
import { getSkillsData } from "@/lib/domain/queries";

export default async function SkillsPage() {
  const data = await getSkillsData();

  return (
    <AppShell>
      <section className="panel">
        <h2>Skills</h2>
        <SkillsList skills={data.skills} />
      </section>
    </AppShell>
  );
}
