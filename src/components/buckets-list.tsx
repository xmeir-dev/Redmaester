"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";

import type { BucketCurationSuggestion } from "@/lib/buckets/curation-types";
import { drainClassification } from "@/lib/client/stream-classify";
import type { BucketAudience, BucketTier } from "@/lib/settings/service";

type BucketRow = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  tier: BucketTier;
  audience: BucketAudience;
  bookmarkCount: number;
  dirtySince: string | Date | null;
  lastMasterSynthesizedAt: string | Date | null;
  masterSkill: {
    id: string;
    name: string;
    description: string;
    updatedAt: string | Date;
  } | null;
  microSkills: Array<{
    id: string;
    name: string;
    description: string;
    referenceCount: number;
    updatedAt: string | Date;
  }>;
  bookmarks: Array<{
    id: string;
    text: string;
    authorHandle: string;
    url: string;
    bookmarkedAt: string | Date;
  }>;
};

type StatusState = {
  kind: "idle" | "saving" | "running" | "done" | "error";
  message?: string;
};

const CURATOR_STARTER_PROMPTS = [
  "Create a real bucket called Polymarket Prediction and fold AI Sports Analytics into it.",
  "Which suggested buckets should merge into my existing real buckets?",
  "What are the 3 best real agent buckets I should start with?",
];

function bookmarkLabel(text: string, fallbackUrl: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return fallbackUrl;
  }
  return trimmed.length > 110 ? `${trimmed.slice(0, 107)}...` : trimmed;
}

function formatTimestamp(value: string | Date | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function audienceLabel(audience: BucketAudience): string {
  switch (audience) {
    case "AGENT":
      return "Agent";
    case "PERSONAL":
      return "Personal";
    default:
      return "Needs decision";
  }
}

function audienceTone(audience: BucketAudience): string {
  switch (audience) {
    case "AGENT":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "PERSONAL":
      return "bg-blue-50 text-blue-700 border-blue-200";
    default:
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

function tierTone(tier: BucketTier): string {
  return tier === "REAL"
    ? "bg-black text-white border-black"
    : "bg-white text-black/55 border-black/10";
}

function suggestionTone(action: BucketCurationSuggestion["action"]): string {
  switch (action) {
    case "MERGE_BUCKET_INTO":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "CREATE_AND_MERGE":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "CREATE_REAL_BUCKET":
      return "bg-violet-50 text-violet-700 border-violet-200";
    default:
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

function suggestionLabel(action: BucketCurationSuggestion["action"]): string {
  switch (action) {
    case "MERGE_BUCKET_INTO":
      return "Merge";
    case "CREATE_AND_MERGE":
      return "Create and merge";
    case "CREATE_REAL_BUCKET":
      return "Create";
    default:
      return "Promote";
  }
}

function suggestionPreview(suggestion: BucketCurationSuggestion): string {
  const sourceLabel =
    suggestion.sourceBucketNames.length > 0
      ? suggestion.sourceBucketNames.join(", ")
      : "new bucket";
  const counts = `${suggestion.preview.bookmarkCount} bookmarks`;
  const microSkills =
    suggestion.preview.microSkillCount > 0
      ? ` and ${suggestion.preview.microSkillCount} micro-skills`
      : "";

  switch (suggestion.action) {
    case "MERGE_BUCKET_INTO":
      return `Move ${counts}${microSkills} from ${sourceLabel} into ${suggestion.targetDisplayName}.`;
    case "CREATE_AND_MERGE":
      return `Create ${suggestion.targetDisplayName} and move ${counts}${microSkills} from ${sourceLabel}.`;
    case "CREATE_REAL_BUCKET":
      return `Create a new ${suggestion.audience === "PERSONAL" ? "personal" : "agent"} real bucket called ${suggestion.targetDisplayName}.`;
    case "PROMOTE_BUCKET":
      return `Promote ${sourceLabel} into a durable ${suggestion.audience === "PERSONAL" ? "personal" : "agent"} bucket.`;
    default:
      return counts;
  }
}

function suggestionApplyLabel(suggestion: BucketCurationSuggestion): string {
  switch (suggestion.action) {
    case "MERGE_BUCKET_INTO":
      return "Apply merge";
    case "CREATE_AND_MERGE":
      return "Create and merge";
    case "CREATE_REAL_BUCKET":
      return "Create bucket";
    case "PROMOTE_BUCKET":
      return "Promote bucket";
    default:
      return "Apply";
  }
}

export function BucketsList({
  buckets,
  initialSuggestions,
  onboarding,
}: {
  buckets: BucketRow[];
  initialSuggestions: BucketCurationSuggestion[];
  onboarding: boolean;
  undecidedBucketCount: number;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftTiers, setDraftTiers] = useState<Record<string, BucketTier>>(
    () => Object.fromEntries(buckets.map((bucket) => [bucket.id, bucket.tier])),
  );
  const [draftAudiences, setDraftAudiences] = useState<
    Record<string, BucketAudience>
  >(() => Object.fromEntries(buckets.map((bucket) => [bucket.id, bucket.audience])));
  const [draftDisplayNames, setDraftDisplayNames] = useState<Record<string, string>>(
    () => Object.fromEntries(buckets.map((bucket) => [bucket.id, bucket.displayName])),
  );
  const [draftDescriptions, setDraftDescriptions] = useState<Record<string, string>>(
    () => Object.fromEntries(buckets.map((bucket) => [bucket.id, bucket.description])),
  );
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [selectedBookmarksByBucket, setSelectedBookmarksByBucket] = useState<
    Record<string, string[]>
  >({});
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createAudience, setCreateAudience] = useState<BucketAudience>("AGENT");
  const [curatorInstruction, setCuratorInstruction] = useState("");
  const [curatorSuggestions, setCuratorSuggestions] =
    useState<BucketCurationSuggestion[]>(initialSuggestions);
  const [curatorModel, setCuratorModel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runState, setRunState] = useState<StatusState>({ kind: "idle" });
  const [curationState, setCurationState] = useState<StatusState>({
    kind: "idle",
  });
  const [curatorLoading, setCuratorLoading] = useState(false);
  const [activeCurationKey, setActiveCurationKey] = useState<string | null>(null);

  useEffect(() => {
    setDraftTiers(
      Object.fromEntries(buckets.map((bucket) => [bucket.id, bucket.tier])),
    );
    setDraftAudiences(
      Object.fromEntries(buckets.map((bucket) => [bucket.id, bucket.audience])),
    );
    setDraftDisplayNames(
      Object.fromEntries(buckets.map((bucket) => [bucket.id, bucket.displayName])),
    );
    setDraftDescriptions(
      Object.fromEntries(buckets.map((bucket) => [bucket.id, bucket.description])),
    );
  }, [buckets]);

  useEffect(() => {
    setCuratorSuggestions(initialSuggestions);
  }, [initialSuggestions]);

  const bucketDrafts = useMemo(
    () =>
      buckets.map((bucket) => ({
        ...bucket,
        tier: draftTiers[bucket.id] ?? bucket.tier,
        audience: draftAudiences[bucket.id] ?? bucket.audience,
        displayName: draftDisplayNames[bucket.id] ?? bucket.displayName,
        description: draftDescriptions[bucket.id] ?? bucket.description,
      })),
    [buckets, draftAudiences, draftDescriptions, draftDisplayNames, draftTiers],
  );

  const realBuckets = bucketDrafts.filter((bucket) => bucket.tier === "REAL");
  const suggestedBuckets = bucketDrafts.filter(
    (bucket) => bucket.tier === "SUGGESTED",
  );
  const persistedRealBuckets = buckets.filter((bucket) => bucket.tier === "REAL");
  const persistedBuckets = buckets;
  const realUndecidedCount = realBuckets.filter(
    (bucket) => bucket.audience === "UNDECIDED",
  ).length;
  const selectedAgentCount = realBuckets.filter(
    (bucket) => bucket.audience === "AGENT",
  ).length;
  const hasUnsavedChanges = useMemo(
    () =>
      buckets.some((bucket) => {
        const draftTier = draftTiers[bucket.id] ?? bucket.tier;
        const draftAudience = draftAudiences[bucket.id] ?? bucket.audience;
        const draftDisplayName = draftDisplayNames[bucket.id] ?? bucket.displayName;
        const draftDescription =
          draftDescriptions[bucket.id] ?? bucket.description;

        return (
          draftTier !== bucket.tier ||
          draftAudience !== bucket.audience ||
          draftDisplayName !== bucket.displayName ||
          draftDescription !== bucket.description
        );
      }),
    [buckets, draftAudiences, draftDescriptions, draftDisplayNames, draftTiers],
  );

  useEffect(() => {
    setMergeTargets((prev) => {
      const next = { ...prev };
      for (const bucket of buckets) {
        const current = next[bucket.id];
        const fallback =
          persistedBuckets.find((candidate) => candidate.id !== bucket.id)?.id ?? "";

        if (!current || current === bucket.id) {
          next[bucket.id] = fallback;
          continue;
        }

        if (!persistedBuckets.some((candidate) => candidate.id === current)) {
          next[bucket.id] = fallback;
        }
      }
      return next;
    });
  }, [buckets, persistedBuckets]);

  useEffect(() => {
    setMoveTargets((prev) => {
      const next = { ...prev };
      for (const bucket of buckets) {
        const current = next[bucket.id];
        const fallback =
          persistedRealBuckets.find((candidate) => candidate.id !== bucket.id)?.id ??
          "";

        if (!current || current === bucket.id) {
          next[bucket.id] = fallback;
          continue;
        }

        if (!persistedRealBuckets.some((candidate) => candidate.id === current)) {
          next[bucket.id] = fallback;
        }
      }
      return next;
    });
  }, [buckets, persistedRealBuckets]);

  if (buckets.length === 0) {
    return (
      <p className="list-meta">
        No buckets yet. Run an initial pull to start organizing bookmarks.
      </p>
    );
  }

  async function refreshBuckets() {
    startTransition(() => {
      router.refresh();
    });
  }

  async function saveBucketPlan(options?: {
    refreshAfterSave?: boolean;
    successMessage?: string;
  }): Promise<boolean> {
    setSaving(true);
    setRunState({
      kind: "saving",
      message: "Saving bucket plan...",
    });

    try {
      const res = await fetch("/api/buckets/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: bucketDrafts.map((bucket) => {
            const trimmedDisplayName = bucket.displayName.trim() || bucket.displayName;
            const trimmedDescription = bucket.description.trim();

            return {
              bucketId: bucket.id,
              tier: bucket.tier,
              audience: bucket.tier === "REAL" ? bucket.audience : "UNDECIDED",
              displayName: trimmedDisplayName,
              ...(trimmedDescription ? { description: trimmedDescription } : {}),
            };
          }),
        }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setRunState({
          kind: "error",
          message: payload.error ?? "Failed to save bucket plan.",
        });
        return false;
      }

      if (options?.refreshAfterSave ?? true) {
        await refreshBuckets();
      }
      setRunState({
        kind: "done",
        message: options?.successMessage ?? "Bucket plan saved.",
      });
      return true;
    } catch {
      setRunState({
        kind: "error",
        message: "Failed to save bucket plan.",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function ensureDraftsSavedForMutation(): Promise<boolean> {
    if (!hasUnsavedChanges) {
      return true;
    }

    setCurationState({
      kind: "saving",
      message: "Saving bucket edits before applying curation...",
    });
    return saveBucketPlan({
      refreshAfterSave: false,
      successMessage: "Bucket edits saved.",
    });
  }

  async function runCurationAction(
    key: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    const saved = await ensureDraftsSavedForMutation();
    if (!saved) {
      return false;
    }

    setActiveCurationKey(key);
    setCurationState({
      kind: "saving",
      message: "Applying bucket change...",
    });

    try {
      const response = await fetch("/api/buckets/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        setCurationState({
          kind: "error",
          message: payload.error ?? "Failed to apply bucket change.",
        });
        return false;
      }

      await refreshBuckets();
      setCurationState({
        kind: "done",
        message: payload.message ?? "Bucket change applied.",
      });
      return true;
    } catch {
      setCurationState({
        kind: "error",
        message: "Failed to apply bucket change.",
      });
      return false;
    } finally {
      setActiveCurationKey(null);
    }
  }

  async function handleCreateBucket() {
    const trimmedDisplayName = createDisplayName.trim();
    const trimmedDescription = createDescription.trim();

    if (!trimmedDisplayName) {
      setCurationState({
        kind: "error",
        message: "Enter a real bucket name first.",
      });
      return;
    }

    const ok = await runCurationAction("create-bucket", {
      action: "create_bucket",
      displayName: trimmedDisplayName,
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      audience: createAudience,
    });

    if (ok) {
      setCreateDisplayName("");
      setCreateDescription("");
    }
  }

  async function handleAskCurator() {
    const trimmed = curatorInstruction.trim();
    if (!trimmed) {
      setCurationState({
        kind: "error",
        message: "Tell the curator what you want changed first.",
      });
      return;
    }

    setCuratorLoading(true);
    setCurationState({
      kind: "saving",
      message: "Thinking through bucket options...",
    });

    try {
      const response = await fetch("/api/buckets/curator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: trimmed }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        suggestions?: BucketCurationSuggestion[];
        usedModel?: string;
      };

      if (!response.ok) {
        setCurationState({
          kind: "error",
          message: payload.error ?? "Curator request failed.",
        });
        return;
      }

      setCuratorSuggestions(payload.suggestions ?? []);
      setCuratorModel(payload.usedModel ?? null);
      setCurationState({
        kind: "done",
        message:
          payload.usedModel === "heuristic-curator"
            ? "Loaded quick suggestions."
            : "Curator suggestions are ready for review.",
      });
    } catch {
      setCurationState({
        kind: "error",
        message: "Curator request failed.",
      });
    } finally {
      setCuratorLoading(false);
    }
  }

  async function applySuggestion(suggestion: BucketCurationSuggestion) {
    switch (suggestion.action) {
      case "PROMOTE_BUCKET": {
        const bucketId = suggestion.sourceBucketIds[0];
        if (!bucketId) {
          return;
        }
        await runCurationAction(suggestion.id, {
          action: "promote_bucket",
          bucketId,
          audience: suggestion.audience ?? "AGENT",
        });
        return;
      }
      case "MERGE_BUCKET_INTO": {
        if (!suggestion.targetBucketId || suggestion.sourceBucketIds.length === 0) {
          return;
        }
        await runCurationAction(suggestion.id, {
          action: "merge_buckets",
          sourceBucketIds: suggestion.sourceBucketIds,
          targetBucketId: suggestion.targetBucketId,
        });
        return;
      }
      case "CREATE_REAL_BUCKET": {
        if (!suggestion.targetDisplayName) {
          return;
        }
        await runCurationAction(suggestion.id, {
          action: "create_bucket",
          displayName: suggestion.targetDisplayName,
          ...(suggestion.targetDescription
            ? { description: suggestion.targetDescription }
            : {}),
          audience: suggestion.audience ?? "AGENT",
        });
        return;
      }
      case "CREATE_AND_MERGE": {
        if (!suggestion.targetDisplayName || suggestion.sourceBucketIds.length === 0) {
          return;
        }
        await runCurationAction(suggestion.id, {
          action: "create_and_merge",
          displayName: suggestion.targetDisplayName,
          ...(suggestion.targetDescription
            ? { description: suggestion.targetDescription }
            : {}),
          audience: suggestion.audience ?? "AGENT",
          sourceBucketIds: suggestion.sourceBucketIds,
        });
      }
    }
  }

  function toggleBookmarkSelection(bucketId: string, bookmarkId: string) {
    setSelectedBookmarksByBucket((prev) => {
      const current = prev[bucketId] ?? [];
      return {
        ...prev,
        [bucketId]: current.includes(bookmarkId)
          ? current.filter((id) => id !== bookmarkId)
          : [...current, bookmarkId],
      };
    });
  }

  async function handleMoveSelectedBookmarks(bucketId: string) {
    const bookmarkIds = selectedBookmarksByBucket[bucketId] ?? [];
    const targetBucketId = moveTargets[bucketId] ?? "";

    if (bookmarkIds.length === 0) {
      setCurationState({
        kind: "error",
        message: "Select one or more bookmarks first.",
      });
      return;
    }

    if (!targetBucketId) {
      setCurationState({
        kind: "error",
        message: "Choose a target bucket first.",
      });
      return;
    }

    const ok = await runCurationAction(`move-bookmarks:${bucketId}`, {
      action: "move_bookmarks",
      bookmarkIds,
      targetBucketId,
    });

    if (ok) {
      setSelectedBookmarksByBucket((prev) => ({
        ...prev,
        [bucketId]: [],
      }));
    }
  }

  async function handleSaveAndStart() {
    const saved = await saveBucketPlan();
    if (!saved) {
      return;
    }

    if (selectedAgentCount === 0) {
      setRunState({
        kind: "done",
        message:
          realBuckets.length === 0
            ? "Saved. Create or promote at least one real bucket when you are ready."
            : "Saved. No real agent buckets selected yet, so agent classification was skipped.",
      });
      return;
    }

    setRunState({
      kind: "running",
      message: "Running agent classification for your real agent buckets...",
    });

    const result = await drainClassification(
      (message) => {
        setRunState({
          kind: "running",
          message,
        });
      },
      undefined,
      async () => {
        await refreshBuckets();
      },
    );

    if (result.needsBucketReview) {
      setRunState({
        kind: "error",
        message:
          "No real buckets exist yet. Promote or create at least one real bucket to keep training the system.",
      });
      return;
    }

    if (result.error) {
      setRunState({
        kind: "error",
        message: result.error,
      });
      return;
    }

    setRunState({
      kind: "done",
      message: `Classification progressed on ${result.classified} bookmarks and created ${result.skillsCreated} micro-skills.`,
    });
    startTransition(() => {
      router.push("/");
      router.refresh();
    });
  }

  function renderBucket(
    bucket: BucketRow & {
      tier: BucketTier;
      audience: BucketAudience;
      displayName: string;
      description: string;
    },
  ) {
    const open = expandedId === bucket.id;
    const mergeOptions = persistedBuckets.filter(
      (candidate) => candidate.id !== bucket.id,
    );
    const bookmarkMoveOptions = persistedRealBuckets.filter(
      (candidate) => candidate.id !== bucket.id,
    );
    const selectedTargetId = mergeTargets[bucket.id] ?? "";
    const selectedBookmarkIds = selectedBookmarksByBucket[bucket.id] ?? [];
    const bookmarkMoveTargetId = moveTargets[bucket.id] ?? "";

    return (
      <article key={bucket.id} className="list-item">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-3">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => setExpandedId(open ? null : bucket.id)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{bucket.displayName}</span>
                <span className="badge">{bucket.bookmarkCount} bookmarks</span>
                <span className="badge">{bucket.microSkills.length} micro-skills</span>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tierTone(
                    bucket.tier,
                  )}`}
                >
                  {bucket.tier === "REAL" ? "Real bucket" : "Suggested bucket"}
                </span>
                {bucket.tier === "REAL" ? (
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${audienceTone(
                      bucket.audience,
                    )}`}
                  >
                    {audienceLabel(bucket.audience)}
                  </span>
                ) : null}
                {bucket.tier === "REAL" &&
                bucket.audience === "AGENT" &&
                bucket.dirtySince ? (
                  <span className="badge">Needs refresh</span>
                ) : null}
                <span className="list-meta ml-auto">
                  Master updated {formatTimestamp(bucket.lastMasterSynthesizedAt)}
                </span>
              </div>
              <p className="list-meta" style={{ marginTop: 4 }}>
                {bucket.description}
              </p>
            </button>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1 rounded-full border border-black/10 bg-white p-1">
                <button
                  type="button"
                  onClick={() =>
                    setDraftTiers((prev) => ({ ...prev, [bucket.id]: "SUGGESTED" }))
                  }
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    bucket.tier === "SUGGESTED"
                      ? "bg-black text-white"
                      : "text-black/50 hover:bg-black/[0.04]"
                  }`}
                >
                  Suggested
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDraftTiers((prev) => ({ ...prev, [bucket.id]: "REAL" }))
                  }
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    bucket.tier === "REAL"
                      ? "bg-black text-white"
                      : "text-black/50 hover:bg-black/[0.04]"
                  }`}
                >
                  Make real
                </button>
              </div>

              {bucket.tier === "REAL" ? (
                <div className="flex flex-wrap items-center gap-1 rounded-full border border-black/10 bg-white p-1">
                  {(["UNDECIDED", "AGENT", "PERSONAL"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        setDraftAudiences((prev) => ({
                          ...prev,
                          [bucket.id]: option,
                        }))
                      }
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        bucket.audience === option
                          ? "bg-black text-white"
                          : "text-black/50 hover:bg-black/[0.04]"
                      }`}
                    >
                      {audienceLabel(option)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-black/35">
                  Suggested buckets are AI proposals. Promote one when you want it to become part of your durable taxonomy.
                </p>
              )}
            </div>
          </div>

          {open ? (
            <div className="space-y-3">
              <div className="rounded bg-black/[0.02] p-3">
                <p className="text-xs uppercase tracking-wider text-black/30">
                  Bucket Details
                </p>
                <div className="mt-2 space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-black/40">
                      Visible name
                    </span>
                    <input
                      type="text"
                      value={bucket.displayName}
                      onChange={(event) =>
                        setDraftDisplayNames((prev) => ({
                          ...prev,
                          [bucket.id]: event.target.value,
                        }))
                      }
                      className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black/70 outline-none transition-colors focus:border-black/30"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-black/40">
                      Description
                    </span>
                    <textarea
                      value={bucket.description}
                      onChange={(event) =>
                        setDraftDescriptions((prev) => ({
                          ...prev,
                          [bucket.id]: event.target.value,
                        }))
                      }
                      rows={3}
                      className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black/70 outline-none transition-colors focus:border-black/30"
                    />
                  </label>
                  <p className="text-xs text-black/35">
                    Rename suggested buckets before promotion, or tighten the wording on real buckets as your taxonomy evolves.
                  </p>
                </div>
              </div>

              <div className="rounded bg-black/[0.02] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-wider text-black/30">
                    Merge Bucket
                  </p>
                  <span className="text-xs text-black/35">
                    Whole-bucket merge only for now
                  </span>
                </div>
                {mergeOptions.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={selectedTargetId}
                      onChange={(event) =>
                        setMergeTargets((prev) => ({
                          ...prev,
                          [bucket.id]: event.target.value,
                        }))
                      }
                      className="min-w-[240px] rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black/70 outline-none transition-colors focus:border-black/30"
                    >
                      {mergeOptions.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.displayName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={
                        !selectedTargetId || activeCurationKey === `merge:${bucket.id}`
                      }
                      onClick={() =>
                        void runCurationAction(`merge:${bucket.id}`, {
                          action: "merge_buckets",
                          sourceBucketIds: [bucket.id],
                          targetBucketId: selectedTargetId,
                        })
                      }
                      className="inline-flex h-9 items-center rounded-[var(--radius)] border border-black/10 bg-white px-4 text-sm font-medium text-black/70 transition-colors hover:bg-black/[0.03] disabled:opacity-60"
                    >
                      {activeCurationKey === `merge:${bucket.id}`
                        ? "Merging..."
                        : "Merge into selected bucket"}
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-black/40">
                    Create or save a real bucket first, then you can fold this bucket into it.
                  </p>
                )}
              </div>

              <div className="rounded bg-black/[0.02] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-wider text-black/30">
                    Move Individual Bookmarks
                  </p>
                  <span className="text-xs text-black/35">
                    Requeues selected bookmarks for classification
                  </span>
                </div>
                {bucket.bookmarks.length > 0 ? (
                  <>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedBookmarksByBucket((prev) => ({
                            ...prev,
                            [bucket.id]: bucket.bookmarks.map((bookmark) => bookmark.id),
                          }))
                        }
                        className="inline-flex h-8 items-center rounded-full border border-black/10 bg-white px-3 text-xs text-black/55 transition-colors hover:bg-black/[0.03]"
                      >
                        Select all shown
                      </button>
                      {selectedBookmarkIds.length > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedBookmarksByBucket((prev) => ({
                              ...prev,
                              [bucket.id]: [],
                            }))
                          }
                          className="inline-flex h-8 items-center rounded-full border border-black/10 bg-white px-3 text-xs text-black/55 transition-colors hover:bg-black/[0.03]"
                        >
                          Clear selection
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-3 space-y-2">
                      {bucket.bookmarks.map((bookmark) => {
                        const checked = selectedBookmarkIds.includes(bookmark.id);
                        return (
                          <label
                            key={bookmark.id}
                            className={`flex cursor-pointer items-start gap-3 rounded bg-white px-3 py-2 shadow-[0_0_0_1px_rgba(0,0,0,0.05)] ${
                              checked ? "ring-1 ring-black/15" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleBookmarkSelection(bucket.id, bookmark.id)
                              }
                              className="mt-1"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-black/70">
                                  {bookmarkLabel(bookmark.text, bookmark.url)}
                                </span>
                                <span className="list-meta">@{bookmark.authorHandle}</span>
                                <span className="list-meta ml-auto">
                                  {formatTimestamp(bookmark.bookmarkedAt)}
                                </span>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    {bookmarkMoveOptions.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select
                          value={bookmarkMoveTargetId}
                          onChange={(event) =>
                            setMoveTargets((prev) => ({
                              ...prev,
                              [bucket.id]: event.target.value,
                            }))
                          }
                          className="min-w-[240px] rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black/70 outline-none transition-colors focus:border-black/30"
                        >
                          {bookmarkMoveOptions.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.displayName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={
                            selectedBookmarkIds.length === 0 ||
                            !bookmarkMoveTargetId ||
                            activeCurationKey === `move-bookmarks:${bucket.id}`
                          }
                          onClick={() => void handleMoveSelectedBookmarks(bucket.id)}
                          className="inline-flex h-9 items-center rounded-[var(--radius)] border border-black/10 bg-white px-4 text-sm font-medium text-black/70 transition-colors hover:bg-black/[0.03] disabled:opacity-60"
                        >
                          {activeCurationKey === `move-bookmarks:${bucket.id}`
                            ? "Moving..."
                            : "Move selected bookmarks"}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-black/40">
                        Create a real bucket first, then you can move selected bookmarks into it.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-black/40">
                    No bookmarks are currently visible in this bucket.
                  </p>
                )}
              </div>

              <div className="rounded bg-black/[0.03] p-3">
                <p className="text-xs uppercase tracking-wider text-black/30">
                  Master Skill
                </p>
                {bucket.masterSkill && bucket.tier === "REAL" ? (
                  <>
                    <p className="mt-1 text-sm font-medium text-black/70">
                      {bucket.displayName}
                    </p>
                    <p className="mt-1 text-sm text-black/50">
                      {bucket.masterSkill.description}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-black/40">
                    {bucket.tier === "REAL"
                      ? "No master skill yet. Real agent buckets will create one when classification runs."
                      : "Suggested buckets do not get master skills until you promote them to real buckets."}
                  </p>
                )}
              </div>

              <div className="rounded bg-black/[0.02] p-3">
                <p className="text-xs uppercase tracking-wider text-black/30">
                  Micro-Skills
                </p>
                {bucket.microSkills.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {bucket.microSkills.map((skill) => (
                      <div
                        key={skill.id}
                        className="rounded bg-white px-3 py-2 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-black/70">
                            {skill.name}
                          </span>
                          <span className="list-meta">{skill.referenceCount} refs</span>
                          <span className="list-meta ml-auto">
                            Updated {formatTimestamp(skill.updatedAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-black/50">
                          {skill.description}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-black/40">No micro-skills yet.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <div className="space-y-4">
      {onboarding ? (
        <div className="rounded-[var(--radius)] border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium uppercase tracking-wider text-amber-700">
              Onboarding
            </span>
            <span className="text-sm text-amber-900/80">
              Start with suggested buckets, then create or promote the ones you want to become part of your real taxonomy.
            </span>
          </div>
          <p className="mt-2 text-sm text-amber-900/70">
            Only <strong>real agent buckets</strong> get bookmark role classification,
            master-skill refreshes, and micro-skill generation. Suggested buckets are
            safe to leave as rough proposals until you decide they matter.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-amber-900/70">
            <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1">
              {suggestedBuckets.length} suggested
            </span>
            <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1">
              {realBuckets.length} real
            </span>
            <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1">
              {selectedAgentCount} real agent
            </span>
            {realUndecidedCount > 0 ? (
              <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1">
                {realUndecidedCount} real buckets need audience decisions
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="rounded-[var(--radius)] border border-black/10 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-black/75">Create Real Bucket</h3>
            <span className="badge">Future bookmarks can route here</span>
          </div>
          <p className="mt-2 text-sm text-black/50">
            Make durable buckets intentionally. Once a bucket is real, future bookmark discovery will prefer routing into it instead of spinning up nearby suggestions.
          </p>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-black/40">Bucket name</span>
              <input
                type="text"
                value={createDisplayName}
                onChange={(event) => setCreateDisplayName(event.target.value)}
                placeholder="Polymarket Prediction"
                className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black/70 outline-none transition-colors focus:border-black/30"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-black/40">Description</span>
              <textarea
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                rows={3}
                placeholder="Strategies and mental models for predicting and trading event markets."
                className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black/70 outline-none transition-colors focus:border-black/30"
              />
            </label>
            <div className="flex flex-wrap items-center gap-1 rounded-full border border-black/10 bg-white p-1">
              {(["AGENT", "PERSONAL"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCreateAudience(option)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    createAudience === option
                      ? "bg-black text-white"
                      : "text-black/50 hover:bg-black/[0.04]"
                  }`}
                >
                  {audienceLabel(option)}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={activeCurationKey === "create-bucket"}
              onClick={() => void handleCreateBucket()}
              className="inline-flex h-9 items-center rounded-[var(--radius)] bg-black px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {activeCurationKey === "create-bucket"
                ? "Creating..."
                : "Create real bucket"}
            </button>
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-black/10 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-black/75">Ask The Curator</h3>
            <span className="badge">Proposes create, merge, and promote actions</span>
          </div>
          <p className="mt-2 text-sm text-black/50">
            Tell Redmaester how you want the taxonomy to evolve. The curator only suggests safe, reviewable actions. It will not apply anything without your approval.
          </p>
          <div className="mt-3 space-y-3">
            <textarea
              value={curatorInstruction}
              onChange={(event) => setCuratorInstruction(event.target.value)}
              rows={4}
              placeholder="AI Sports Analytics should probably fold into a Polymarket Prediction bucket."
              className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm text-black/70 outline-none transition-colors focus:border-black/30"
            />
            <div className="flex flex-wrap gap-2">
              {CURATOR_STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setCuratorInstruction(prompt)}
                  className="inline-flex h-8 items-center rounded-full border border-black/10 bg-white px-3 text-xs text-black/55 transition-colors hover:bg-black/[0.03]"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={curatorLoading}
                onClick={() => void handleAskCurator()}
                className="inline-flex h-9 items-center rounded-[var(--radius)] border border-black/10 bg-white px-4 text-sm font-medium text-black/70 transition-colors hover:bg-black/[0.03] disabled:opacity-60"
              >
                {curatorLoading ? "Thinking..." : "Ask curator"}
              </button>
              {curatorModel ? (
                <p className="text-xs text-black/35">Last run: {curatorModel}</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {curatorSuggestions.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-black/70">Curation Suggestions</h3>
            <span className="badge">{curatorSuggestions.length}</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {curatorSuggestions.map((suggestion) => (
              <article
                key={suggestion.id}
                className="rounded-[var(--radius)] border border-black/10 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${suggestionTone(
                      suggestion.action,
                    )}`}
                  >
                    {suggestionLabel(suggestion.action)}
                  </span>
                  <span className="rounded-full border border-black/10 bg-black/[0.03] px-2.5 py-1 text-xs text-black/45">
                    {suggestion.origin === "curator" ? "AI curator" : "Quick suggestion"}
                  </span>
                </div>
                <p className="mt-3 text-sm font-medium text-black/75">
                  {suggestion.title}
                </p>
                <p className="mt-1 text-sm text-black/55">{suggestion.reason}</p>
                <p className="mt-2 text-xs text-black/40">
                  {suggestionPreview(suggestion)}
                </p>
                <button
                  type="button"
                  disabled={activeCurationKey === suggestion.id}
                  onClick={() => void applySuggestion(suggestion)}
                  className="mt-3 inline-flex h-9 items-center rounded-[var(--radius)] border border-black/10 bg-white px-4 text-sm font-medium text-black/70 transition-colors hover:bg-black/[0.03] disabled:opacity-60"
                >
                  {activeCurationKey === suggestion.id
                    ? "Applying..."
                    : suggestionApplyLabel(suggestion)}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveBucketPlan()}
          className="inline-flex h-9 items-center rounded-[var(--radius)] border border-black/10 bg-white px-4 text-sm font-medium text-black/70 transition-colors hover:bg-black/[0.03] disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save bucket plan"}
        </button>
        <button
          type="button"
          disabled={saving || runState.kind === "running"}
          onClick={() => void handleSaveAndStart()}
          className="inline-flex h-9 items-center rounded-[var(--radius)] bg-black px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {runState.kind === "running"
            ? "Classifying..."
            : "Save and start agent classification"}
        </button>
        {hasUnsavedChanges ? (
          <span className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs text-black/45">
            Unsaved bucket edits
          </span>
        ) : null}
        {runState.message ? (
          <p
            className={
              runState.kind === "error"
                ? "text-sm text-red-600"
                : "text-sm text-black/50"
            }
          >
            {runState.message}
          </p>
        ) : null}
      </div>

      {curationState.message ? (
        <p
          className={
            curationState.kind === "error"
              ? "text-sm text-red-600"
              : "text-sm text-black/50"
          }
        >
          {curationState.message}
        </p>
      ) : null}

      {realBuckets.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-black/70">Real Buckets</h3>
            <span className="badge">{realBuckets.length}</span>
          </div>
          <div className="list">{realBuckets.map(renderBucket)}</div>
        </section>
      ) : null}

      {suggestedBuckets.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-black/70">Suggested Buckets</h3>
            <span className="badge">{suggestedBuckets.length}</span>
          </div>
          <div className="list">{suggestedBuckets.map(renderBucket)}</div>
        </section>
      ) : null}
    </div>
  );
}
