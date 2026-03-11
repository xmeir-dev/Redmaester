"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { streamClassify } from "@/lib/client/stream-classify";

type SyncOption = { label: string; activeLabel: string; mode: string; limit?: number };

const syncOptions: SyncOption[] = [
  { label: "Last 10", activeLabel: "Pulling last 10…", mode: "FULL", limit: 10 },
  { label: "Full pull", activeLabel: "Pulling all bookmarks…", mode: "FULL" },
];

function emitLog(message: string) {
  window.dispatchEvent(new CustomEvent("sync-log", { detail: { message } }));
}

export function SyncButton() {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState<SyncOption | null>(null);
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  async function handleCount() {
    setOpen(false);
    setCounting(true);
    window.dispatchEvent(new CustomEvent("sync-start"));
    emitLog("Counting bookmarks on X...");
    try {
      const res = await fetch("/api/bookmarks/count", { method: "POST" });
      const payload = (await res.json().catch(() => ({}))) as {
        count?: number; apiCalls?: number; stoppedReason?: string; error?: string;
      };
      if (!res.ok) {
        emitLog(`Count error: ${payload.error ?? "unknown"}`);
      } else {
        const suffix = payload.stoppedReason
          ? ` (incomplete — ${payload.stoppedReason})`
          : "";
        emitLog(`You have ${payload.count?.toLocaleString()} bookmarks on X${suffix} (${payload.apiCalls} API call${payload.apiCalls === 1 ? "" : "s"})`);
      }
    } catch {
      emitLog("Count failed. Try again.");
    } finally {
      setCounting(false);
      window.dispatchEvent(new CustomEvent("sync-end"));
    }
  }

  async function handleSync(option: SyncOption) {
    setOpen(false);
    setSyncing(option);
    window.dispatchEvent(new CustomEvent("sync-start"));
    try {
      const body: Record<string, unknown> = { mode: option.mode };
      if (option.limit) body.limit = option.limit;
      emitLog(`Fetching bookmarks from X${option.limit ? ` (last ${option.limit})` : " (full)"}...`);
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string; newBookmarks?: number; notes?: string;
      };
      if (!res.ok) {
        emitLog(`Sync error: ${payload.error ?? "unknown"}`);
        window.dispatchEvent(new CustomEvent("sync-end", { detail: { error: payload.error ?? "Sync failed" } }));
        return;
      }
      emitLog(`Synced ${payload.newBookmarks ?? 0} new bookmarks`);
      if (payload.notes) emitLog(payload.notes);

      // Refresh page so the table appears immediately with synced bookmarks
      router.refresh();

      // Trigger classification pipeline (streamed)
      try {
        emitLog("Running classification pipeline...");
        const classifyResult = await streamClassify(emitLog, (bookmarkId, step) => {
          window.dispatchEvent(new CustomEvent("bookmark-step", { detail: { bookmarkId, step } }));
        });
        if (classifyResult.blocked) {
          emitLog("Classification blocked — budget exceeded");
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
      setSyncing(null);
    }
  }

  if (syncing || counting) {
    return (
      <span className="inline-flex h-9 items-center rounded-[var(--radius)] bg-black px-5 text-sm font-medium text-white opacity-60">
        {counting ? "Counting…" : syncing!.activeLabel}
      </span>
    );
  }

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] bg-black px-5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
      >
        Pull from X
        <ChevronDown size={14} className="opacity-60" />
      </button>
      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full z-50 mt-1.5 min-w-[160px] rounded-[var(--radius)] bg-white p-1.5 shadow-[0_0_0_1px_hsl(var(--border)),0_8px_24px_rgba(0,0,0,0.08)]">
          {syncOptions.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => void handleSync(option)}
              className="flex w-full items-center rounded-md px-3 py-2 text-sm text-black hover:bg-black/[0.04] transition-colors"
            >
              {option.label}
            </button>
          ))}
          <div className="my-1 border-t border-black/[0.06]" />
          <button
            type="button"
            onClick={() => void handleCount()}
            className="flex w-full items-center rounded-md px-3 py-2 text-sm text-black/50 hover:bg-black/[0.04] hover:text-black/70 transition-colors"
          >
            Count bookmarks
          </button>
        </div>
      )}
    </div>
  );
}
