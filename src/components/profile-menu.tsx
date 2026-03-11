"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { streamClassify } from "@/lib/client/stream-classify";

type SyncMode = "AUTO" | "FULL";
type SyncAction = "last10" | "full" | null;

function emitLog(message: string) {
  window.dispatchEvent(new CustomEvent("sync-log", { detail: { message } }));
}

export function ProfileMenu({
  connected,
  username,
  displayName,
}: {
  connected: boolean;
  username?: string;
  displayName?: string;
}) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [syncAction, setSyncAction] = useState<SyncAction>(null);
  const [avatarIndex, setAvatarIndex] = useState(0);
  const [clearConfirm, setClearConfirm] = useState(false);

  const normalizedUsername = username?.trim();

  useEffect(() => {
    if (!isMenuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setIsMenuOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isMenuOpen]);

  useEffect(() => { setAvatarIndex(0); }, [normalizedUsername]);

  // Reset confirm state when menu closes
  useEffect(() => {
    if (!isMenuOpen) setClearConfirm(false);
  }, [isMenuOpen]);

  async function runSync(mode: SyncMode, limit?: number, action: SyncAction = "full") {
    setIsMenuOpen(false);
    setSyncAction(action);
    window.dispatchEvent(new CustomEvent("sync-start"));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const body: Record<string, unknown> = { mode };
      if (limit) body.limit = limit;
      emitLog(`Fetching bookmarks from X${limit ? ` (last ${limit})` : " (full)"}...`);
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string; newBookmarks?: number; triagedCount?: number; notes?: string;
      };
      if (!res.ok) {
        emitLog(`Sync error: ${payload.error ?? "unknown"}`);
        window.dispatchEvent(new CustomEvent("sync-end", { detail: { error: payload.error ?? "Sync failed" } }));
        return;
      }
      emitLog(`Synced ${payload.newBookmarks ?? 0} new bookmarks`);
      if (payload.notes) emitLog(payload.notes);

      // Trigger classification pipeline (streamed)
      let classifiedCount = 0;
      let skillsCreated = 0;
      try {
        emitLog("Running classification pipeline...");
        const classifyResult = await streamClassify(emitLog, (bookmarkId, step) => {
          window.dispatchEvent(new CustomEvent("bookmark-step", { detail: { bookmarkId, step } }));
        });
        classifiedCount = classifyResult.classified ?? 0;
        skillsCreated = classifyResult.skillsCreated ?? 0;

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
      window.dispatchEvent(new CustomEvent("sync-end", { detail: { newBookmarks: payload.newBookmarks ?? 0, classifiedCount, skillsCreated } }));
      router.refresh();
    } catch (err) {
      const errorMsg = err instanceof Error && err.name === "AbortError" ? "Sync timed out." : "Sync failed. Try again.";
      emitLog(errorMsg);
      window.dispatchEvent(new CustomEvent("sync-end", { detail: { error: errorMsg } }));
    } finally {
      clearTimeout(timeout);
      setSyncAction(null);
    }
  }

  async function handleClearBookmarks() {
    if (!clearConfirm) {
      setClearConfirm(true);
      return;
    }
    setIsMenuOpen(false);
    setClearConfirm(false);
    try {
      await fetch("/api/bookmarks/clear", { method: "POST" });
      router.refresh();
    } catch {
      // silent
    }
  }

  if (!connected) {
    return (
      <a
        href="/api/auth/x/start"
        className="inline-flex h-8 items-center rounded-[var(--radius)] bg-black px-4 text-sm font-medium text-white hover:opacity-90 transition-opacity"
      >
        Connect X
      </a>
    );
  }

  const handle = normalizedUsername ? `@${normalizedUsername}` : "@connected";
  const fallback = displayName?.trim().charAt(0).toUpperCase() || normalizedUsername?.charAt(0).toUpperCase() || "X";
  const avatarCandidates = normalizedUsername
    ? [
        `https://unavatar.io/x/${encodeURIComponent(normalizedUsername)}`,
        `https://unavatar.io/twitter/${encodeURIComponent(normalizedUsername)}`,
      ]
    : [];
  const avatarUrl = avatarCandidates[avatarIndex];

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        disabled={syncAction !== null}
        onClick={() => setIsMenuOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg py-1 px-2 text-sm shadow-[0_0_0_1px_hsl(var(--border))] hover:bg-black/[0.03] transition-colors disabled:opacity-60"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={handle}
            className="h-6 w-6 rounded-full object-cover"
            onError={() => setAvatarIndex((v) => v + 1)}
          />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/10 text-xs font-bold">
            {fallback}
          </span>
        )}
        <span className="text-sm text-black/70">{handle}</span>
        <ChevronDown size={14} className="text-black/30" />
      </button>

      {isMenuOpen ? (
        <div
          className="absolute right-0 top-full z-[var(--z-dropdown)] mt-1.5 min-w-[160px] rounded-[var(--radius)] bg-white p-1.5 shadow-[0_0_0_1px_hsl(var(--border)),0_8px_24px_rgba(0,0,0,0.08)]"
          style={{ zIndex: "var(--z-dropdown)" }}
        >
          <button
            type="button"
            disabled={syncAction !== null}
            onClick={() => void runSync("FULL", 10, "last10")}
            className="flex w-full items-center rounded-md px-3 py-2 text-sm hover:bg-black/[0.04] transition-colors disabled:opacity-50"
          >
            {syncAction === "last10" ? "Pulling…" : "Pull last 10"}
          </button>
          <button
            type="button"
            disabled={syncAction !== null}
            onClick={() => void runSync("FULL", undefined, "full")}
            className="flex w-full items-center rounded-md px-3 py-2 text-sm hover:bg-black/[0.04] transition-colors disabled:opacity-50"
          >
            {syncAction === "full" ? "Pulling…" : "Full pull"}
          </button>
          <button
            type="button"
            onClick={() => void handleClearBookmarks()}
            className="flex w-full items-center rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            {clearConfirm ? "Are you sure?" : "Clear all bookmarks"}
          </button>
          <div className="my-1 border-t border-[hsl(var(--border))]" />
          {[
            { href: "/skills", label: "Skills" },
            { href: "/logs", label: "Logs" },
            { href: "/triage", label: "Triage" },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setIsMenuOpen(false)}
              className="flex w-full items-center rounded-md px-3 py-2 text-sm hover:bg-black/[0.04] transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
