"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

interface LogEntry {
  time: string;
  message: string;
}

function timestamp(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export function SyncLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [visible, setVisible] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onLog(e: Event) {
      const msg = (e as CustomEvent<{ message: string }>).detail?.message;
      if (msg) {
        setEntries((prev) => [...prev, { time: timestamp(), message: msg }]);
        setVisible(true);
        setCollapsed(false);
      }
    }
    function onStart() {
      setEntries([{ time: timestamp(), message: "Sync started" }]);
      setVisible(true);
      setCollapsed(false);
    }
    function onEnd(e: Event) {
      const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
      const msg = detail?.error
        ? `Sync failed: ${detail.error}`
        : "Sync complete";
      setEntries((prev) => [...prev, { time: timestamp(), message: msg }]);
    }

    window.addEventListener("sync-log", onLog);
    window.addEventListener("sync-start", onStart);
    window.addEventListener("sync-end", onEnd);
    return () => {
      window.removeEventListener("sync-log", onLog);
      window.removeEventListener("sync-start", onStart);
      window.removeEventListener("sync-end", onEnd);
    };
  }, []);

  useEffect(() => {
    if (!collapsed) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, collapsed]);

  if (!visible || entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[#1e1e1e] overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 bg-[#1e1e1e] hover:bg-white/5 transition-colors"
      >
        <span className="text-xs font-medium text-white/60 font-mono">
          Sync Log ({entries.length})
        </span>
        {collapsed ? (
          <ChevronDown size={12} className="text-white/40" />
        ) : (
          <ChevronUp size={12} className="text-white/40" />
        )}
      </button>
      {!collapsed && (
        <div className="max-h-[200px] overflow-y-auto border-t border-white/10 px-3 py-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb:hover]:bg-white/25">
          {entries.map((entry, i) => (
            <p key={i} className="text-xs text-white/70 font-mono leading-5">
              <span className="text-white/40">[{entry.time}]</span> {entry.message}
            </p>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
