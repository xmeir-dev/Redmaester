"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ContentTypeFilter = "all" | "article" | "post";
type ClassificationStatusFilter = "all" | "skill" | "reference" | "triage" | "unclassified";

type HomeFiltersProps = {
  title: string;
  query: string;
  typeFilter: ContentTypeFilter;
  statusFilter: ClassificationStatusFilter;
  skillFilter: string;
  skills: string[];
  resultsCount: number;
  totalCount: number;
};

export function HomeFilters({
  title,
  query,
  typeFilter,
  statusFilter,
  skillFilter,
  skills,
  resultsCount,
  totalCount,
}: HomeFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(query);
  const [isOpen, setIsOpen] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | { newBookmarks: number; classifiedCount: number; skillsCreated: number } | { error: string }>("idle");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onSyncStart() { setSyncState("syncing"); }
    function onSyncEnd(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.error) {
        setSyncState({ error: detail.error });
      } else {
        setSyncState({ newBookmarks: detail.newBookmarks, classifiedCount: detail.classifiedCount ?? 0, skillsCreated: detail.skillsCreated ?? 0 });
      }
    }
    window.addEventListener("sync-start", onSyncStart);
    window.addEventListener("sync-end", onSyncEnd);
    return () => {
      window.removeEventListener("sync-start", onSyncStart);
      window.removeEventListener("sync-end", onSyncEnd);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) setIsOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const activeChips = useMemo(() => {
    const chips: { label: string; onRemove: () => void }[] = [];
    if (typeFilter !== "all") chips.push({ label: `Type: ${typeFilter}`, onRemove: () => updateParams({ type: "all" }) });
    if (statusFilter !== "all") chips.push({ label: `Status: ${statusFilter}`, onRemove: () => updateParams({ status: "all" }) });
    if (skillFilter) chips.push({ label: `Skill: ${skillFilter}`, onRemove: () => updateParams({ skill: "" }) });
    return chips;
  }, [typeFilter, statusFilter, skillFilter]);

  const hasActiveFilters = activeChips.length > 0 || query.trim().length > 0;

  // Flash "Showing all N results" for 5s on mount / when filters are cleared, then fade out
  const [allFlash, setAllFlash] = useState<"visible" | "fading" | "hidden">("visible");
  const flashTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevHadFilters = useRef(hasActiveFilters);

  useEffect(() => {
    if (prevHadFilters.current && !hasActiveFilters) {
      setAllFlash("visible");
    }
    prevHadFilters.current = hasActiveFilters;
  }, [hasActiveFilters]);

  useEffect(() => {
    if (!hasActiveFilters && allFlash === "visible") {
      flashTimerRef.current = setTimeout(() => setAllFlash("fading"), 5000);
      return () => clearTimeout(flashTimerRef.current);
    }
  }, [hasActiveFilters, allFlash]);

  useEffect(() => {
    if (document.activeElement !== searchRef.current) setSearchValue(query);
  }, [query]);

  function updateParams(next: {
    q?: string;
    type?: ContentTypeFilter;
    status?: ClassificationStatusFilter;
    skill?: string;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextQuery = (next.q ?? params.get("q") ?? "").trim();
    const nextType = next.type ?? ((params.get("type") as ContentTypeFilter | null) ?? "all");
    const nextStatus = next.status ?? ((params.get("status") as ClassificationStatusFilter | null) ?? "all");
    const nextSkill = (next.skill ?? params.get("skill") ?? "").trim();

    params.delete("filter");
    params.delete("xFolder");
    params.delete("showFolders");
    nextQuery ? params.set("q", nextQuery) : params.delete("q");
    nextType !== "all" ? params.set("type", nextType) : params.delete("type");
    nextStatus !== "all" ? params.set("status", nextStatus) : params.delete("status");
    nextSkill ? params.set("skill", nextSkill) : params.delete("skill");

    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    startTransition(() => { router.replace(href, { scroll: false }); });
  }

  useEffect(() => {
    const paramQuery = (searchParams.get("q") ?? "").trim();
    if (searchValue.trim() === paramQuery) return;
    const timeout = setTimeout(() => { updateParams({ q: searchValue }); }, 250);
    return () => clearTimeout(timeout);
  }, [searchValue, searchParams]);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[14px] font-medium text-black/70">{title}</h2>
        <span className={cn("inline-flex items-center gap-1.5 rounded-md border border-black/10 px-2.5 py-0.5 text-sm tabular-nums", syncState === "idle" && resultsCount === totalCount && allFlash === "hidden" && "hidden")}>
          {syncState === "syncing" ? (
            <span className="inline-flex items-center gap-1.5 text-black/30">
              Syncing
              <span className="inline-flex items-center gap-[3px]">
                <span className="h-[5px] w-[5px] rounded-full bg-black/40" style={{ animation: "dot-wave 1.2s ease-in-out infinite" }} />
                <span className="h-[5px] w-[5px] rounded-full bg-black/40" style={{ animation: "dot-wave 1.2s ease-in-out 0.2s infinite" }} />
                <span className="h-[5px] w-[5px] rounded-full bg-black/40" style={{ animation: "dot-wave 1.2s ease-in-out 0.4s infinite" }} />
              </span>
            </span>
          ) : typeof syncState === "object" && "error" in syncState ? (
            <>
              <span className="text-black/50">{syncState.error}</span>
              <button type="button" onClick={() => setSyncState("idle")} className="text-black/30 hover:text-black/70 transition-colors">
                <X size={12} />
              </button>
            </>
          ) : typeof syncState === "object" && "newBookmarks" in syncState ? (
            <>
              <span className="text-black/70">{syncState.newBookmarks}</span>
              <span className="text-black/30"> new, </span>
              <span className="text-black/70">{syncState.classifiedCount}</span>
              <span className="text-black/30"> classified, </span>
              <span className="text-black/70">{syncState.skillsCreated}</span>
              <span className="text-black/30"> skills</span>
              <button type="button" onClick={() => setSyncState("idle")} className="text-black/30 hover:text-black/70 transition-colors">
                <X size={12} />
              </button>
            </>
          ) : resultsCount === totalCount ? (
            allFlash !== "hidden" ? (
              <span
                className={`inline-flex items-center gap-1 transition-opacity duration-200 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${allFlash === "fading" ? "opacity-0" : "opacity-100"}`}
                onTransitionEnd={() => { if (allFlash === "fading") setAllFlash("hidden"); }}
              >
                <span className="text-black/30">Showing all </span>
                <span className="text-black/70">{totalCount.toLocaleString()}</span>
                <span className="text-black/30"> results</span>
              </span>
            ) : null
          ) : (
            <>
              <span className="text-black/30">Showing </span>
              <span className="text-black/70">{resultsCount.toLocaleString()}</span>
              <span className="text-black/30"> results out of </span>
              <span className="text-black/70">{totalCount.toLocaleString()}</span>
              <button
                type="button"
                onClick={() => updateParams({ q: "", type: "all", status: "all", skill: "" })}
                className="group/clear relative text-black/30 hover:text-black/70 transition-colors"
              >
                <X size={12} />
                <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-2 py-1 text-[11px] text-white opacity-0 group-hover/clear:opacity-100 transition-opacity">
                  Clear filters
                </span>
              </button>
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Active chips */}
        {activeChips.map((chip) => (
          <span
            key={chip.label}
            className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs shadow-[0_0_0_1px_hsl(var(--border))]"
          >
            {chip.label}
            <button
              type="button"
              onClick={chip.onRemove}
              className="ml-0.5 rounded-full p-0.5 text-black/40 hover:text-black/70 transition-colors"
              aria-label={`Remove ${chip.label} filter`}
            >
              <X size={10} />
            </button>
          </span>
        ))}

        {/* Search */}
        <Input
          ref={searchRef}
          type="search"
          className="h-8 w-56 text-xs"
          placeholder="Search bookmarks"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />

        {/* Filters dropdown */}
        <div className="relative" ref={dropdownRef}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={cn(isOpen && "shadow-[0_0_0_1px_rgba(0,0,0,0.25)]")}
            onClick={() => setIsOpen((v) => !v)}
            aria-expanded={isOpen}
          >
            <SlidersHorizontal size={13} className="text-black/70" />
            Filters
            {activeChips.length > 0 ? (
              <span className="ml-0.5 rounded-full bg-black text-white text-[10px] px-1.5 py-px tabular-nums">
                {activeChips.length}
              </span>
            ) : null}
          </Button>

          {isOpen ? (
            <div className="absolute right-0 top-full z-[var(--z-dropdown)] mt-1.5 w-72 rounded-[var(--radius)] bg-white p-4 shadow-[0_0_0_1px_hsl(var(--border)),0_8px_24px_rgba(0,0,0,0.08)] space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FilterSelect
                  label="Type"
                  value={typeFilter}
                  onChange={(v) => updateParams({ type: v as ContentTypeFilter })}
                >
                  <option value="all">All types</option>
                  <option value="article">Article</option>
                  <option value="post">Post</option>
                </FilterSelect>

                <FilterSelect
                  label="Status"
                  value={statusFilter}
                  onChange={(v) => updateParams({ status: v as ClassificationStatusFilter })}
                >
                  <option value="all">All statuses</option>
                  <option value="skill">Skill</option>
                  <option value="reference">Reference</option>
                  <option value="triage">Triage</option>
                  <option value="unclassified">Unclassified</option>
                </FilterSelect>

                {skills.length > 0 ? (
                  <FilterSelect
                    label="Skill"
                    value={skillFilter}
                    onChange={(v) => updateParams({ skill: v })}
                  >
                    <option value="">All skills</option>
                    {skills.map((s) => <option key={s} value={s}>{s}</option>)}
                  </FilterSelect>
                ) : null}

              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-normal text-black/30">
        {label}
      </span>
      <select
        className="h-9 rounded-[var(--radius)] bg-white px-3 text-sm font-medium text-black/70 shadow-[0_0_0_1px_hsl(var(--border))] focus:outline-none focus:shadow-[0_0_0_1px_rgba(0,0,0,0.25)] transition-shadow"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}
