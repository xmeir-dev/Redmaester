// Legacy route from an earlier IA — forwards old folder links to the home
// page filter so saved URLs keep working.
import { redirect } from "next/navigation";

export default async function XFoldersPage({
  searchParams
}: {
  searchParams: Promise<{ xFolder?: string; folder?: string }>;
}) {
  const params = await searchParams;
  const folder = params.xFolder?.trim() || params.folder?.trim();

  if (folder) {
    const next = new URLSearchParams({ xFolder: folder });
    redirect(`/?${next.toString()}`);
  }

  redirect("/");
}
