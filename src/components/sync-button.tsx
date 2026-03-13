"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { drainClassification } from "@/lib/client/stream-classify";

function emitLog(message: string) {
  window.dispatchEvent(new CustomEvent("sync-log", { detail: { message } }));
}

export function SyncButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function handleInitialPull() {
    setSyncing(true);
    window.dispatchEvent(new CustomEvent("sync-start"));

    try {
      emitLog("Importing the latest 500 bookmarks from X...");
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "FULL" }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        newBookmarks?: number;
        notes?: string;
      };

      if (!res.ok) {
        emitLog(`Sync error: ${payload.error ?? "unknown"}`);
        window.dispatchEvent(new CustomEvent("sync-end", { detail: { error: payload.error ?? "Sync failed" } }));
        return;
      }

      emitLog(`Imported ${payload.newBookmarks ?? 0} bookmarks`);
      if (payload.notes) {
        emitLog(payload.notes);
      }

      router.refresh();

      try {
        emitLog("Discovering buckets and classifying reviewed agent buckets...");
        const classifyResult = await drainClassification(
          emitLog,
          (bookmarkId, step) => {
            window.dispatchEvent(
              new CustomEvent("bookmark-step", {
                detail: { bookmarkId, step },
              }),
            );
          },
          async () => {
            router.refresh();
          },
        );

        if (classifyResult.blocked) {
          emitLog("Classification paused — monthly budget reached");
        }
        if (classifyResult.needsBucketReview) {
          emitLog("Guided bucket setup required before agent classification can continue");
          window.dispatchEvent(new CustomEvent("sync-end"));
          router.push("/buckets?onboarding=1");
          return;
        }
        if (classifyResult.enrichmentWarning) {
          emitLog(classifyResult.enrichmentWarning);
        }
        if (classifyResult.error) {
          emitLog(`Classification error: ${classifyResult.error}`);
        }
      } catch {
        emitLog("Classification skipped (network error)");
      }

      window.dispatchEvent(new CustomEvent("sync-end"));
      router.refresh();
    } catch {
      emitLog("Sync failed. Try again.");
      window.dispatchEvent(new CustomEvent("sync-end", { detail: { error: "Sync failed" } }));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button
      type="button"
      disabled={syncing}
      onClick={() => void handleInitialPull()}
      className="inline-flex h-9 items-center rounded-[var(--radius)] bg-black px-5 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-60"
    >
      {syncing ? "Importing…" : "Initial pull (latest 500)"}
    </button>
  );
}
