import { redirect } from "next/navigation";

export default async function BookmarksPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams();

  if (params.q) {
    next.set("q", params.q);
  }
  if (params.filter) {
    next.set("filter", params.filter);
  }

  const suffix = next.toString();
  redirect(suffix ? `/?${suffix}` : "/");
}
