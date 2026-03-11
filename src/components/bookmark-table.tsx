"use client";

import { Check, ChevronRight, Newspaper, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

export type BookmarkStatusData = {
  badge: "Skill" | "Reference" | "Triaged" | "Pending" | "Unrelated" | "Failed" | "In Queue" | "Enriching" | "Classifying" | "Done";
  enrichments: {
    url: string;
    title: string | null;
    method: string;
    error: string | null;
    contentLength: number;
  }[];
  classification: {
    type: string;
    action: string;
    confidence: number;
    rationale: string | null;
    skillName: string | null;
    fallback: boolean;
  } | null;
  triage: {
    reason: string;
    details: string | null;
  } | null;
};

export type BookmarkTableRow = {
  id: string;
  url: string;
  title: string;
  type: "article" | "post";
  dateLabel: string;
  dateTooltip: string;
  status: BookmarkStatusData;
};

type BookmarkTableProps = {
  rows: BookmarkTableRow[];
  totalCount: number;
  initialVisible?: number;
  loadStep?: number;
};

const STEP_TO_BADGE: Record<string, BookmarkStatusData["badge"]> = {
  queue: "In Queue",
  enriching: "Enriching",
  classifying: "Classifying",
  skill: "Skill",
  reference: "Reference",
  triaged: "Triaged",
  unrelated: "Unrelated",
  failed: "Failed",
  done: "Done",
};

export function BookmarkTable({
  rows,
  totalCount,
  initialVisible = 30,
  loadStep = 10,
}: BookmarkTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [visibleCount, setVisibleCount] = useState(Math.min(initialVisible, rows.length));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const [overlayStatus, setOverlayStatus] = useState<Map<string, string>>(new Map());
  const [syncing, setSyncing] = useState(false);

  // Listen for real-time bookmark step events
  useEffect(() => {
    function onBookmarkStep(e: Event) {
      const { bookmarkId, step } = (e as CustomEvent<{ bookmarkId: string; step: string }>).detail;
      setOverlayStatus((prev) => {
        const next = new Map(prev);
        next.set(bookmarkId, step);
        return next;
      });
    }
    function onSyncStart() {
      setOverlayStatus(new Map());
      setSyncing(true);
    }
    function onSyncEnd() {
      setOverlayStatus(new Map());
      setSyncing(false);
    }
    window.addEventListener("bookmark-step", onBookmarkStep);
    window.addEventListener("sync-start", onSyncStart);
    window.addEventListener("sync-end", onSyncEnd);
    return () => {
      window.removeEventListener("bookmark-step", onBookmarkStep);
      window.removeEventListener("sync-start", onSyncStart);
      window.removeEventListener("sync-end", onSyncEnd);
    };
  }, []);

  useEffect(() => {
    setVisibleCount(Math.min(initialVisible, rows.length));
  }, [rows.length, initialVisible]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [rows]);

  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const hasMore = visibleCount < rows.length;

  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selectedIds.has(r.id));
  const someSelected = visibleRows.some((r) => selectedIds.has(r.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(rows.length, c + loadStep));
        }
      },
      { root: null, rootMargin: "300px 0px", threshold: 0.01 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, rows.length, loadStep]);

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(visibleRows.map((r) => r.id)));
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (rows.length === 0) {
    const hasFilters = totalCount > 0;
    return (
      <div className="flex flex-col items-center justify-center py-20">
        {/* Illustration */}
        <div className="relative mb-6">
          <div className="h-40 w-40 rounded-full bg-black/[0.03]" />
          <div className="absolute left-1/2 top-1/2 h-16 w-28 -translate-x-1/2 -translate-y-[60%] -rotate-6 rounded-lg bg-black/[0.06]" />
          <div className="absolute left-1/2 top-1/2 flex h-16 w-28 -translate-x-1/2 -translate-y-1/2 rotate-2 flex-col justify-center gap-2 rounded-lg bg-white px-3 shadow-[0_1px_4px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.04)]">
            <div className="h-1.5 w-14 rounded-full bg-black/[0.08]" />
            <div className="h-1.5 w-10 rounded-full bg-black/[0.05]" />
            <div className="h-1.5 w-16 rounded-full bg-black/[0.05]" />
          </div>
        </div>
        {hasFilters ? (
          <>
            <p className="text-sm font-medium text-black/70">No bookmarks found</p>
            <p className="mt-1 text-sm text-black/30">Try adjusting your search or filters</p>
            <button
              type="button"
              onClick={() => router.replace(pathname, { scroll: false })}
              className="mt-4 rounded-md border border-black/10 px-4 py-1.5 text-sm text-black/50 hover:text-black/70 hover:border-black/20 transition-colors"
            >
              Reset filters
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-black/70">No bookmarks yet</p>
            <p className="mt-1 max-w-xs text-center text-sm text-black/30">
              Bookmark a post on x.com, then come back and refresh from your profile menu
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Floating bulk action bar */}
      <div
        className={cn(
          "fixed bottom-8 left-1/2 z-[var(--z-modal)] -translate-x-1/2 transition-all duration-300",
          selectedIds.size > 0
            ? "translate-y-0 opacity-100"
            : "translate-y-4 opacity-0 pointer-events-none"
        )}
      >
        <div className="flex items-center gap-3 rounded-full bg-white px-5 py-3 text-sm shadow-[0_0_0_1px_hsl(var(--border)),0_8px_32px_rgba(0,0,0,0.12)]">
          <span className="tabular-nums text-black/50">
            <span className="font-semibold text-black">{selectedIds.size}</span> selected
          </span>
          <div className="h-4 w-px bg-black/10" />
          <Button variant="secondary" size="sm" disabled>
            Send to agent
          </Button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-1 flex h-5 w-5 items-center justify-center rounded-full text-black/30 hover:bg-black/[0.06] hover:text-black/60 transition-colors"
            aria-label="Clear selection"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-clip rounded-[var(--radius)] shadow-[0_0_0_1px_hsl(var(--border))]">
        <table className="w-full table-fixed border-collapse text-sm">
          {/* Header */}
          <thead>
            <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--gray-2))]">
              <th className="w-10 px-3 py-2.5 text-center">
                <TableCheckbox
                  inputRef={selectAllRef}
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                  style={{ opacity: someSelected ? 1 : undefined }}
                  className="opacity-0 [tr:hover_&]:opacity-100"
                />
              </th>
              <th className="max-w-0 px-3 py-2.5 text-left text-xs font-normal uppercase tracking-wider text-black/30">
                Bookmark
              </th>
              <th className="w-32 whitespace-nowrap px-3 py-2.5 text-right text-xs font-normal uppercase tracking-wider text-black/30">
                Date
              </th>
              <th className="w-28 whitespace-nowrap px-3 py-2.5 text-right text-xs font-normal uppercase tracking-wider text-black/30">
                Status
              </th>
              <th className="w-8" />
            </tr>
          </thead>

          {/* Rows */}
          <tbody className="divide-y divide-[hsl(var(--border))] bg-white">
            {visibleRows.map((row) => {
              const isSelected = selectedIds.has(row.id);
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "group cursor-pointer transition-colors duration-500",
                    "hover:bg-black/[0.012]",
                    isSelected && "bg-black/[0.008]"
                  )}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a, input")) return;
                    toggleRow(row.id);
                  }}
                >
                  {/* Checkbox */}
                  <td className="w-10 px-3 py-3 text-center">
                    <TableCheckbox
                      checked={isSelected}
                      onChange={() => toggleRow(row.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${row.title}`}
                      style={{ opacity: isSelected ? 1 : undefined }}
                      className="opacity-0 group-hover:opacity-100"
                    />
                  </td>

                  {/* Title */}
                  <td className="max-w-0 px-3 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <TypeIcon type={row.type} />
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block min-w-0 truncate text-sm font-normal"
                        title={row.title}
                      >
                        {row.title}
                      </a>
                    </div>
                  </td>

                  {/* Date */}
                  <td className="w-32 whitespace-nowrap px-3 py-3 text-right text-sm tabular-nums text-black/30" title={row.dateTooltip}>
                    {row.dateLabel}
                  </td>

                  {/* Status */}
                  <td className="w-28 px-3 py-3 text-right">
                    {overlayStatus.has(row.id) ? (
                      <OverlayBadge step={overlayStatus.get(row.id)!} />
                    ) : syncing && row.status.badge === "Pending" ? (
                      <OverlayBadge step="queue" />
                    ) : (
                      <StatusBadge status={row.status} />
                    )}
                  </td>

                  {/* Chevron */}
                  <td className="w-8 pr-2 text-right">
                    <ChevronRight
                      size={14}
                      className="ml-auto text-black/20 opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore ? (
        <div ref={sentinelRef} className="flex items-center justify-between pt-1 text-xs text-black/30">
          <span className="tabular-nums">Showing {visibleRows.length} of {rows.length}</span>
          <button
            type="button"
            className="text-black/40 hover:text-black/70 transition-colors"
            onClick={() => setVisibleCount((c) => Math.min(rows.length, c + loadStep))}
          >
            Load {loadStep} more
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TableCheckbox({
  checked,
  onChange,
  onClick,
  className,
  style,
  inputRef,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  onClick?: React.MouseEventHandler;
  className?: string;
  style?: React.CSSProperties;
  inputRef?: React.Ref<HTMLInputElement>;
  "aria-label"?: string;
}) {
  return (
    <span className={cn("relative inline-flex h-[14px] w-[14px] transition-opacity", className)} style={style}>
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        onClick={onClick}
        aria-label={ariaLabel}
        className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none"
      />
      {/* Border ring + fill */}
      <span className="pointer-events-none absolute inset-0 rounded-[4px] shadow-[0_0_0_1px_rgba(0,0,0,0.25)] transition-colors peer-hover:shadow-[0_0_0_1px_rgba(0,0,0,0.5)] peer-checked:bg-black peer-checked:shadow-[0_0_0_1px_black]" />
      {/* Checkmark */}
      <span className="pointer-events-none absolute inset-0 hidden items-center justify-center peer-checked:flex">
        <Check size={9} strokeWidth={3} className="text-white" />
      </span>
    </span>
  );
}

function TypeIcon({ type }: { type: BookmarkTableRow["type"] }) {
  if (type === "article") {
    return <Newspaper size={13} className="shrink-0 text-black/30" />;
  }
  return <span className="shrink-0 text-[13px] leading-none opacity-50">𝕏</span>;
}

const badgeStyles: Record<BookmarkStatusData["badge"], { dot: string; text: string }> = {
  Skill: { dot: "bg-emerald-500", text: "text-black/60" },
  Reference: { dot: "bg-blue-500", text: "text-black/60" },
  Triaged: { dot: "bg-amber-500", text: "text-black/60" },
  Pending: { dot: "bg-black/20", text: "text-black/30" },
  Unrelated: { dot: "bg-black/15", text: "text-black/25" },
  Failed: { dot: "bg-red-400", text: "text-red-400/70" },
  "In Queue": { dot: "bg-black/20 animate-pulse", text: "text-black/30" },
  Enriching: { dot: "bg-amber-400 animate-pulse", text: "text-amber-600/70" },
  Classifying: { dot: "bg-amber-400 animate-pulse", text: "text-amber-600/70" },
  Done: { dot: "bg-emerald-500", text: "text-emerald-600/70" },
};

const ACTIVE_STEPS = new Set(["enriching", "classifying"]);

const OVERLAY_LABEL: Record<string, string> = {
  queue: "Queue",
  enriching: "Enriching\u2026",
  classifying: "Classifying\u2026",
  skill: "Skill",
  reference: "Reference",
  triaged: "Triaged",
  unrelated: "Unrelated",
  failed: "Failed",
  done: "Done",
};

function OverlayBadge({ step }: { step: string }) {
  const label = OVERLAY_LABEL[step] ?? step;
  const isActive = ACTIVE_STEPS.has(step);
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-end overflow-hidden rounded px-1.5 py-0.5 text-xs text-black/40",
        isActive && "text-black/60"
      )}
    >
      {isActive && (
        <span className="pointer-events-none absolute inset-0 animate-[shimmer_1.5s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-black/[0.06] to-transparent" />
      )}
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: BookmarkStatusData }) {
  const style = badgeStyles[status.badge];
  const [open, setOpen] = useState(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    enterTimer.current = setTimeout(() => setOpen(true), 200);
  }, []);

  const handleLeave = useCallback(() => {
    if (enterTimer.current) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    leaveTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);

  useEffect(() => {
    return () => {
      if (enterTimer.current) clearTimeout(enterTimer.current);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    };
  }, []);

  return (
    <span
      className="relative inline-flex items-center justify-end gap-1.5"
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
    >
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", style.dot)} />
      <span className={cn("text-xs", style.text)}>{status.badge}</span>
      {open ? <StatusHoverCard status={status} /> : null}
    </span>
  );
}

function StatusHoverCard({ status }: { status: BookmarkStatusData }) {
  return (
    <div
      className="absolute right-0 top-full mt-1.5 z-[var(--z-dropdown)] w-[340px] rounded-[var(--radius)] bg-white p-3 text-left text-xs shadow-[0_0_0_1px_hsl(var(--border)),0_4px_16px_rgba(0,0,0,0.1)]"
      onClick={(e) => e.stopPropagation()}
    >
      {status.classification ? (
        <div className="space-y-1.5">
          <div className="font-medium text-black/70 uppercase tracking-wider text-[10px]">Classification</div>
          <div className="space-y-0.5 text-black/50">
            <Row label="Type" value={status.classification.type} />
            <Row label="Action" value={status.classification.action} />
            <Row label="Confidence" value={`${Math.round(status.classification.confidence * 100)}%`} />
            {status.classification.skillName ? (
              <Row label="Skill" value={status.classification.skillName} />
            ) : null}
            {status.classification.rationale ? (
              <div className="pt-0.5">
                <span className="text-black/30">Rationale: </span>
                <span className="text-black/50">{status.classification.rationale}</span>
              </div>
            ) : null}
            {status.classification.fallback ? (
              <div className="pt-0.5 text-amber-600">Fallback match</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {status.enrichments.length > 0 ? (
        <div className={cn("space-y-1.5", status.classification && "mt-3 border-t border-black/5 pt-3")}>
          <div className="font-medium text-black/70 uppercase tracking-wider text-[10px]">Enrichment</div>
          <div className="space-y-2">
            {status.enrichments.map((e) => (
              <div key={e.url} className="text-black/50">
                <div className="truncate text-black/40" title={e.url}>{e.url}</div>
                <div className="flex gap-2 text-black/30 mt-0.5">
                  <span className="rounded bg-black/[0.05] px-1">{e.method}</span>
                  {e.error ? (
                    <span className="text-red-400 truncate">{e.error}</span>
                  ) : (
                    <span>{formatBytes(e.contentLength)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {status.triage ? (
        <div className={cn("space-y-1.5", (status.classification || status.enrichments.length > 0) && "mt-3 border-t border-black/5 pt-3")}>
          <div className="font-medium text-black/70 uppercase tracking-wider text-[10px]">Triage</div>
          <div className="text-black/50">
            <div>{status.triage.reason}</div>
            {status.triage.details ? (
              <div className="text-black/30 mt-0.5">{status.triage.details}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {!status.classification && status.enrichments.length === 0 && !status.triage ? (
        <div className="text-black/30">No pipeline data yet</div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-black/30">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
