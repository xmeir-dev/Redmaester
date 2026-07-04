// Legacy route from an earlier IA — kept so old links and bookmarks still work.
import { redirect } from "next/navigation";

export default function AgentsPage() {
  redirect("/");
}
