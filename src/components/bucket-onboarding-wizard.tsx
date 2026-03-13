"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";

import type {
  BucketOnboardingBookmarkSample,
  BucketOnboardingDraft,
} from "@/lib/buckets/curation-types";
import { drainClassification } from "@/lib/client/stream-classify";
import type { BucketAudience, BucketTier } from "@/lib/settings/service";

type BucketRow = {
  id: string;
  displayName: string;
  description: string;
  tier: BucketTier;
  audience: BucketAudience;
  bookmarkCount: number;
  microSkills: Array<{ id: string }>;
  bookmarks: Array<BucketOnboardingBookmarkSample>;
};

type OnboardingState = {
  startedAt: string | null;
  completedAt: string | null;
  lastDraftAt: string | null;
  needsOnboarding: boolean;
};

type StatusState = {
  kind: "idle" | "loading" | "saving" | "running" | "done" | "error";
  message?: string;
};

type DraftResponse = {
  drafts?: BucketOnboardingDraft[];
  usedModel?: string;
  onboarding?: OnboardingState;
  error?: string;
};

type ApplyResponse = {
  completed?: boolean;
  realAgentBucketCount?: number;
  onboarding?: OnboardingState;
  error?: string;
};

const STEP_LABELS = [
  {
    title: "Starter buckets",
    description: "Review the AI-prefilled starter plan and make quick keep, merge, or defer decisions.",
  },
  {
    title: "Refine drafts",
    description: "Rename buckets, adjust audience, add a new real bucket, or choose merge targets.",
  },
  {
    title: "Start classification",
    description: "Approve at least one real agent bucket, then let Redmaester continue classification.",
  },
] as const;

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function bookmarkPreview(sample: BucketOnboardingBookmarkSample): string {
  const trimmed = sample.text.trim();
  if (!trimmed) {
    return sample.url;
  }

  return trimmed.length > 110 ? `${trimmed.slice(0, 107)}...` : trimmed;
}

function actionLabel(action: BucketOnboardingDraft["action"]): string {
  switch (action) {
    case "PROMOTE":
      return "Promote";
    case "MERGE":
      return "Merge";
    case "CREATE":
      return "Create";
    case "KEEP_PERSONAL":
      return "Keep personal";
    default:
      return "Defer";
  }
}

function actionTone(action: BucketOnboardingDraft["action"]): string {
  switch (action) {
    case "PROMOTE":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "MERGE":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "CREATE":
      return "bg-violet-50 text-violet-700 border-violet-200";
    case "KEEP_PERSONAL":
      return "bg-blue-50 text-blue-700 border-blue-200";
    default:
      return "bg-white text-black/50 border-black/10";
  }
}

function audienceTone(audience: BucketAudience): string {
  switch (audience) {
    case "AGENT":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "PERSONAL":
      return "bg-blue-50 text-blue-700 border-blue-200";
    default:
      return "bg-white text-black/50 border-black/10";
  }
}

function audienceLabel(audience: BucketAudience): string {
  switch (audience) {
    case "AGENT":
      return "Agent";
    case "PERSONAL":
      return "Personal";
    default:
      return "Deferred";
  }
}

function normalizeDraftForAction(
  draft: BucketOnboardingDraft,
  action: BucketOnboardingDraft["action"],
): BucketOnboardingDraft {
  if (action === "DEFER") {
    return {
      ...draft,
      action,
      tier: "SUGGESTED",
      audience: "UNDECIDED",
      mergeTargetBucketId: undefined,
    };
  }

  if (action === "KEEP_PERSONAL") {
    return {
      ...draft,
      action,
      tier: "REAL",
      audience: "PERSONAL",
      mergeTargetBucketId: undefined,
    };
  }

  if (action === "PROMOTE") {
    return {
      ...draft,
      action,
      tier: "REAL",
      audience: draft.audience === "UNDECIDED" ? "AGENT" : draft.audience,
      mergeTargetBucketId: undefined,
    };
  }

  if (action === "MERGE") {
    return {
      ...draft,
      action,
      tier: "REAL",
      audience: draft.audience === "UNDECIDED" ? "AGENT" : draft.audience,
    };
  }

  return {
    ...draft,
    action,
    tier: "REAL",
    audience: draft.audience === "UNDECIDED" ? "AGENT" : draft.audience,
  };
}

function stepTone(active: boolean, complete: boolean): string {
  if (complete) {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }

  if (active) {
    return "border-black bg-black text-white";
  }

  return "border-black/10 bg-white text-black/55";
}

export function BucketOnboardingWizard({
  buckets,
  onboarding,
}: {
  buckets: BucketRow[];
  onboarding: OnboardingState;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<BucketOnboardingDraft[]>([]);
  const [usedModel, setUsedModel] = useState<string | null>(null);
  const [wizardOnboarding, setWizardOnboarding] = useState(onboarding);
  const [loadState, setLoadState] = useState<StatusState>({
    kind: "loading",
    message: "Preparing your starter bucket plan...",
  });
  const [applyState, setApplyState] = useState<StatusState>({ kind: "idle" });
  const [draftVersion, setDraftVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadDrafts() {
      setLoadState({
        kind: "loading",
        message: draftVersion === 0 ? "Preparing your starter bucket plan..." : "Refreshing your bucket draft...",
      });

      try {
        const res = await fetch("/api/buckets/onboarding/draft", {
          method: "POST",
        });
        const payload = (await res.json().catch(() => ({}))) as DraftResponse;

        if (!res.ok) {
          throw new Error(payload.error ?? "Failed to generate onboarding draft.");
        }

        if (cancelled) {
          return;
        }

        setDrafts(payload.drafts ?? []);
        setUsedModel(payload.usedModel ?? "heuristic-onboarding");
        if (payload.onboarding) {
          setWizardOnboarding(payload.onboarding);
        }
        setLoadState({ kind: "done" });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setLoadState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to generate onboarding draft.",
        });
      }
    }

    void loadDrafts();

    return () => {
      cancelled = true;
    };
  }, [draftVersion]);

  const targetableBuckets = useMemo(() => {
    const persistedTargets = buckets
      .filter((bucket) => bucket.tier === "REAL")
      .map((bucket) => ({
        id: bucket.id,
        label: `${bucket.displayName} (existing real bucket)`,
      }));
    const draftTargets = drafts
      .filter(
        (draft) =>
          draft.action === "PROMOTE" ||
          draft.action === "KEEP_PERSONAL" ||
          draft.action === "CREATE",
      )
      .map((draft) => ({
        id: draft.id,
        label:
          draft.action === "CREATE"
            ? `${draft.draftName} (planned new bucket)`
            : `${draft.draftName} (planned real bucket)`,
      }));

    return [...persistedTargets, ...draftTargets];
  }, [buckets, drafts]);

  const starterDrafts = useMemo(
    () =>
      drafts
        .filter((draft) => draft.action !== "DEFER")
        .sort((a, b) => {
          const aWeight = a.audience === "AGENT" ? 0 : 1;
          const bWeight = b.audience === "AGENT" ? 0 : 1;
          return aWeight - bWeight;
        }),
    [drafts],
  );

  const futureRealAgentCount = useMemo(() => {
    const realAgentTargets = new Set(
      buckets
        .filter((bucket) => bucket.tier === "REAL" && bucket.audience === "AGENT")
        .map((bucket) => bucket.id),
    );

    for (const draft of drafts) {
      if (draft.action === "PROMOTE" && draft.audience === "AGENT" && draft.bucketId) {
        realAgentTargets.add(draft.bucketId);
      }

      if (draft.action === "CREATE" && draft.audience === "AGENT") {
        realAgentTargets.add(draft.id);
      }
    }

    return realAgentTargets.size;
  }, [buckets, drafts]);

  const summary = useMemo(() => {
    return {
      creates: drafts.filter((draft) => draft.action === "CREATE").length,
      merges: drafts.filter((draft) => draft.action === "MERGE").length,
      personal: drafts.filter((draft) => draft.action === "KEEP_PERSONAL").length,
      deferred: drafts.filter((draft) => draft.action === "DEFER").length,
      promoted: drafts.filter((draft) => draft.action === "PROMOTE").length,
    };
  }, [drafts]);

  function updateDraft(
    draftId: string,
    updater: (draft: BucketOnboardingDraft) => BucketOnboardingDraft,
  ) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === draftId ? updater(draft) : draft)),
    );
  }

  function mergeOptionsForDraft(draftId: string) {
    return targetableBuckets.filter((target) => target.id !== draftId);
  }

  function handleActionChange(
    draftId: string,
    action: BucketOnboardingDraft["action"],
  ) {
    updateDraft(draftId, (draft) => {
      const next = normalizeDraftForAction(draft, action);
      if (action !== "MERGE") {
        return next;
      }

      const nextTarget = mergeOptionsForDraft(draftId)[0]?.id;
      return {
        ...next,
        mergeTargetBucketId: next.mergeTargetBucketId ?? nextTarget,
      };
    });
  }

  function handleAudienceChange(draftId: string, audience: BucketAudience) {
    updateDraft(draftId, (draft) => ({
      ...draft,
      audience,
      tier: audience === "UNDECIDED" ? "SUGGESTED" : "REAL",
      action:
        audience === "PERSONAL"
          ? draft.action === "MERGE"
            ? "MERGE"
            : "KEEP_PERSONAL"
          : draft.action === "KEEP_PERSONAL"
            ? draft.bucketId
              ? "PROMOTE"
              : "CREATE"
            : draft.action,
    }));
  }

  function addCreateDraft() {
    const index = drafts.filter((draft) => draft.action === "CREATE").length + 1;
    setDrafts((current) => [
      ...current,
      {
        id: `draft:create:manual:${Date.now()}:${index}`,
        draftName: `New Agent Bucket ${index}`,
        draftDescription: "Durable bucket for a domain you want to actively train agents on.",
        audience: "AGENT",
        tier: "REAL",
        action: "CREATE",
        sampleBookmarkIds: [],
        sampleBookmarks: [],
        reason: "Added manually during onboarding.",
        origin: "heuristic",
      },
    ]);
    setStep(1);
  }

  function removeCreateDraft(draftId: string) {
    setDrafts((current) => current.filter((draft) => draft.id !== draftId));
  }

  async function applyAndStart() {
    setApplyState({
      kind: "saving",
      message: "Applying your starter taxonomy...",
    });

    try {
      const res = await fetch("/api/buckets/onboarding/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drafts }),
      });
      const payload = (await res.json().catch(() => ({}))) as ApplyResponse;

      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to apply onboarding draft.");
      }

      if (payload.onboarding) {
        setWizardOnboarding(payload.onboarding);
      }

      startTransition(() => {
        router.refresh();
      });

      if (!payload.completed || (payload.realAgentBucketCount ?? 0) <= 0) {
        setApplyState({
          kind: "done",
          message:
            "Draft saved, but you still need at least one real agent bucket before classification can begin.",
        });
        return;
      }

      setApplyState({
        kind: "running",
        message: "Starting agent classification...",
      });

      const classifyResult = await drainClassification(
        (message) => {
          setApplyState({
            kind: "running",
            message,
          });
        },
        undefined,
        async () => {
          router.refresh();
        },
      );

      if (classifyResult.error) {
        throw new Error(classifyResult.error);
      }

      if (classifyResult.needsBucketReview) {
        setApplyState({
          kind: "done",
          message:
            "Your starter buckets were saved, but classification is waiting for one approved real agent bucket.",
        });
        return;
      }

      if (classifyResult.blocked) {
        setApplyState({
          kind: "done",
          message:
            "Your starter buckets are live. Classification paused because the monthly budget limit was reached.",
        });
      } else {
        setApplyState({
          kind: "done",
          message: "Starter buckets saved. Redirecting to your bookmarks...",
        });
      }

      startTransition(() => {
        router.refresh();
        router.push("/");
      });
    } catch (error) {
      setApplyState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to apply onboarding draft.",
      });
    }
  }

  const canContinueFromStarter = true;
  const canStartClassification = futureRealAgentCount > 0;

  return (
    <div className="space-y-5">
      <div className="rounded-[var(--radius)] border border-black/10 bg-[#f9f2e4] px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center rounded-full border border-[#d7b879] bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.12em] text-[#b8742b]">
              Guided setup
            </div>
            <h3 className="text-xl font-semibold text-black/80">
              Approve one solid agent bucket, then classify the rest later.
            </h3>
            <p className="max-w-3xl text-sm leading-6 text-black/60">
              Redmaester is treating every discovered bucket as a suggestion first.
              The AI draft gives you a compact starter plan, but nothing becomes
              real until you approve it.
            </p>
          </div>
          <div className="space-y-1 text-sm text-black/50">
            <div>Draft source: {usedModel ?? "loading..."}</div>
            <div>Draft updated: {formatTimestamp(wizardOnboarding.lastDraftAt)}</div>
            <div>
              Started: {formatTimestamp(wizardOnboarding.startedAt)}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {STEP_LABELS.map((item, index) => (
            <button
              key={item.title}
              type="button"
              onClick={() => setStep(index)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${stepTone(
                step === index,
                step > index,
              )}`}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/10 text-xs font-medium">
                {index + 1}
              </span>
              {item.title}
            </button>
          ))}
        </div>
      </div>

      {loadState.kind === "error" ? (
        <div className="rounded-[var(--radius)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-medium">Couldn&apos;t build the onboarding draft.</div>
          <div className="mt-1">{loadState.message}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDraftVersion((value) => value + 1)}
              className="inline-flex h-9 items-center rounded-[var(--radius)] bg-black px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Retry draft
            </button>
            <Link
              href="/buckets?advanced=1"
              className="inline-flex h-9 items-center rounded-[var(--radius)] border border-black/10 px-4 text-sm font-medium text-black/70 transition-colors hover:bg-black/[0.03]"
            >
              Open advanced editor
            </Link>
          </div>
        </div>
      ) : null}

      {loadState.kind === "loading" ? (
        <div className="rounded-[var(--radius)] border border-black/10 bg-white px-4 py-6 text-sm text-black/55">
          {loadState.message}
        </div>
      ) : null}

      {loadState.kind !== "loading" && loadState.kind !== "error" ? (
        <>
          {step === 0 ? (
            <section className="space-y-4 rounded-[var(--radius)] border border-black/10 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h4 className="text-lg font-semibold text-black/80">
                    {STEP_LABELS[0].title}
                  </h4>
                  <p className="mt-1 max-w-3xl text-sm text-black/55">
                    {STEP_LABELS[0].description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDraftVersion((value) => value + 1)}
                    className="inline-flex h-9 items-center rounded-[var(--radius)] border border-black/10 px-4 text-sm font-medium text-black/70 transition-colors hover:bg-black/[0.03]"
                  >
                    Refresh draft
                  </button>
                  <button
                    type="button"
                    onClick={addCreateDraft}
                    className="inline-flex h-9 items-center rounded-[var(--radius)] bg-black px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  >
                    Add real bucket
                  </button>
                </div>
              </div>

              {starterDrafts.length === 0 ? (
                <div className="rounded-[var(--radius)] border border-black/10 bg-[#faf7f1] px-4 py-4 text-sm text-black/55">
                  The draft deferred everything. Add one real agent bucket or open the
                  advanced editor if you want to curate manually.
                </div>
              ) : null}

              <div className="grid gap-3">
                {starterDrafts.map((draft) => {
                  const mergeTargets = mergeOptionsForDraft(draft.id);

                  return (
                    <article
                      key={draft.id}
                      className="rounded-[var(--radius)] border border-black/10 bg-[#faf7f1] p-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${actionTone(
                                draft.action,
                              )}`}
                            >
                              {actionLabel(draft.action)}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${audienceTone(
                                draft.audience,
                              )}`}
                            >
                              {audienceLabel(draft.audience)}
                            </span>
                            <span className="text-xs text-black/45">
                              {draft.sampleBookmarks.length || buckets.find((bucket) => bucket.id === draft.bucketId)?.bookmarkCount || 0} bookmarks
                            </span>
                          </div>
                          <div>
                            <h5 className="text-base font-semibold text-black/80">
                              {draft.draftName}
                            </h5>
                            <p className="mt-1 text-sm text-black/55">
                              {draft.draftDescription}
                            </p>
                          </div>
                          <p className="text-sm leading-6 text-black/60">{draft.reason}</p>
                        </div>
                        <div className="min-w-[220px] space-y-2">
                          {draft.bucketId ? (
                            <select
                              value={draft.action}
                              onChange={(event) =>
                                handleActionChange(
                                  draft.id,
                                  event.target.value as BucketOnboardingDraft["action"],
                                )
                              }
                              className="h-10 w-full rounded-[var(--radius)] border border-black/10 bg-white px-3 text-sm text-black/70 outline-none focus:border-black/30"
                            >
                              <option value="PROMOTE">Keep as real agent bucket</option>
                              <option value="KEEP_PERSONAL">Keep as real personal bucket</option>
                              <option value="MERGE">Merge into another bucket</option>
                              <option value="DEFER">Defer for later</option>
                            </select>
                          ) : null}
                          {draft.action === "MERGE" ? (
                            <select
                              value={draft.mergeTargetBucketId ?? ""}
                              onChange={(event) =>
                                updateDraft(draft.id, (current) => ({
                                  ...current,
                                  mergeTargetBucketId: event.target.value || undefined,
                                }))
                              }
                              className="h-10 w-full rounded-[var(--radius)] border border-black/10 bg-white px-3 text-sm text-black/70 outline-none focus:border-black/30"
                            >
                              <option value="">Choose merge target</option>
                              {mergeTargets.map((target) => (
                                <option key={target.id} value={target.id}>
                                  {target.label}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </div>

                      {draft.sampleBookmarks.length > 0 ? (
                        <div className="mt-3 grid gap-2">
                          {draft.sampleBookmarks.slice(0, 3).map((sample) => (
                            <div
                              key={sample.id}
                              className="rounded-[var(--radius)] border border-black/10 bg-white px-3 py-2 text-sm text-black/65"
                            >
                              <span className="font-medium text-black/75">
                                @{sample.authorHandle}
                              </span>{" "}
                              {bookmarkPreview(sample)}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              <div className="rounded-[var(--radius)] border border-dashed border-black/10 bg-white px-4 py-3 text-sm text-black/55">
                {summary.deferred} suggested bucket{summary.deferred === 1 ? "" : "s"} will stay deferred by default.
                They won&apos;t block onboarding, and you can clean them up later in the{" "}
                <Link href="/buckets?advanced=1" className="underline underline-offset-2">
                  advanced editor
                </Link>
                .
              </div>
            </section>
          ) : null}

          {step === 1 ? (
            <section className="space-y-4 rounded-[var(--radius)] border border-black/10 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h4 className="text-lg font-semibold text-black/80">
                    {STEP_LABELS[1].title}
                  </h4>
                  <p className="mt-1 max-w-3xl text-sm text-black/55">
                    {STEP_LABELS[1].description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addCreateDraft}
                  className="inline-flex h-9 items-center rounded-[var(--radius)] border border-black/10 px-4 text-sm font-medium text-black/70 transition-colors hover:bg-black/[0.03]"
                >
                  Add another real bucket
                </button>
              </div>

              <div className="space-y-3">
                {drafts.map((draft) => {
                  const mergeTargets = mergeOptionsForDraft(draft.id);
                  const canRemove = draft.action === "CREATE" && !draft.bucketId;

                  return (
                    <article
                      key={draft.id}
                      className="rounded-[var(--radius)] border border-black/10 bg-[#faf7f1] p-4"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                        <div className="flex-1 space-y-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="space-y-1 text-sm text-black/55">
                              <span className="font-medium text-black/70">Bucket name</span>
                              <input
                                value={draft.draftName}
                                onChange={(event) =>
                                  updateDraft(draft.id, (current) => ({
                                    ...current,
                                    draftName: event.target.value,
                                  }))
                                }
                                className="h-10 w-full rounded-[var(--radius)] border border-black/10 bg-white px-3 text-black/75 outline-none focus:border-black/30"
                              />
                            </label>
                            <label className="space-y-1 text-sm text-black/55">
                              <span className="font-medium text-black/70">Action</span>
                              {draft.bucketId ? (
                                <select
                                  value={draft.action}
                                  onChange={(event) =>
                                    handleActionChange(
                                      draft.id,
                                      event.target.value as BucketOnboardingDraft["action"],
                                    )
                                  }
                                  className="h-10 w-full rounded-[var(--radius)] border border-black/10 bg-white px-3 text-black/75 outline-none focus:border-black/30"
                                >
                                  <option value="PROMOTE">Promote to real agent</option>
                                  <option value="KEEP_PERSONAL">Promote to real personal</option>
                                  <option value="MERGE">Merge into another bucket</option>
                                  <option value="DEFER">Defer for later</option>
                                </select>
                              ) : (
                                <div className="flex h-10 items-center rounded-[var(--radius)] border border-black/10 bg-white px-3 text-sm text-black/65">
                                  Create new real bucket
                                </div>
                              )}
                            </label>
                          </div>

                          <label className="space-y-1 text-sm text-black/55">
                            <span className="font-medium text-black/70">Description</span>
                            <textarea
                              rows={3}
                              value={draft.draftDescription}
                              onChange={(event) =>
                                updateDraft(draft.id, (current) => ({
                                  ...current,
                                  draftDescription: event.target.value,
                                }))
                              }
                              className="w-full rounded-[var(--radius)] border border-black/10 bg-white px-3 py-2 text-black/75 outline-none focus:border-black/30"
                            />
                          </label>

                          <div className="flex flex-wrap items-center gap-2">
                            {(["AGENT", "PERSONAL"] as const).map((audience) => {
                              const disabled = draft.action === "DEFER";
                              const active = draft.audience === audience;
                              const label =
                                audience === "AGENT" ? "Agent-facing" : "Human-only";

                              return (
                                <button
                                  key={audience}
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => handleAudienceChange(draft.id, audience)}
                                  className={`inline-flex h-9 items-center rounded-full border px-4 text-sm transition-colors ${
                                    active
                                      ? "border-black bg-black text-white"
                                      : "border-black/10 bg-white text-black/60 hover:bg-black/[0.03]"
                                  } disabled:cursor-not-allowed disabled:opacity-40`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                            {draft.action === "DEFER" ? (
                              <span className="text-sm text-black/45">
                                Deferred buckets stay suggested until you revisit them.
                              </span>
                            ) : null}
                          </div>

                          {draft.action === "MERGE" ? (
                            <label className="space-y-1 text-sm text-black/55">
                              <span className="font-medium text-black/70">Merge target</span>
                              <select
                                value={draft.mergeTargetBucketId ?? ""}
                                onChange={(event) =>
                                  updateDraft(draft.id, (current) => ({
                                    ...current,
                                    mergeTargetBucketId: event.target.value || undefined,
                                  }))
                                }
                                className="h-10 w-full rounded-[var(--radius)] border border-black/10 bg-white px-3 text-black/75 outline-none focus:border-black/30"
                              >
                                <option value="">Choose merge target</option>
                                {mergeTargets.map((target) => (
                                  <option key={target.id} value={target.id}>
                                    {target.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                        </div>

                        <div className="w-full max-w-[320px] space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${actionTone(
                                draft.action,
                              )}`}
                            >
                              {actionLabel(draft.action)}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${audienceTone(
                                draft.audience,
                              )}`}
                            >
                              {audienceLabel(draft.audience)}
                            </span>
                          </div>
                          <p className="text-sm leading-6 text-black/60">{draft.reason}</p>
                          {draft.sampleBookmarks.length > 0 ? (
                            <div className="space-y-2">
                              <div className="text-xs font-medium uppercase tracking-[0.12em] text-black/40">
                                Sample bookmarks
                              </div>
                              {draft.sampleBookmarks.slice(0, 3).map((sample) => (
                                <div
                                  key={sample.id}
                                  className="rounded-[var(--radius)] border border-black/10 bg-white px-3 py-2 text-sm text-black/65"
                                >
                                  <span className="font-medium text-black/75">
                                    @{sample.authorHandle}
                                  </span>{" "}
                                  {bookmarkPreview(sample)}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-[var(--radius)] border border-dashed border-black/10 bg-white px-3 py-3 text-sm text-black/45">
                              This is a new bucket draft. You can keep refining it here before starting classification.
                            </div>
                          )}
                          {canRemove ? (
                            <button
                              type="button"
                              onClick={() => removeCreateDraft(draft.id)}
                              className="inline-flex h-9 items-center rounded-[var(--radius)] border border-black/10 px-4 text-sm font-medium text-black/65 transition-colors hover:bg-black/[0.03]"
                            >
                              Remove draft
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="space-y-4 rounded-[var(--radius)] border border-black/10 bg-white p-4">
              <div>
                <h4 className="text-lg font-semibold text-black/80">
                  {STEP_LABELS[2].title}
                </h4>
                <p className="mt-1 max-w-3xl text-sm text-black/55">
                  {STEP_LABELS[2].description}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-[var(--radius)] border border-black/10 bg-[#faf7f1] px-4 py-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-black/40">
                    Real agent buckets
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-black/80">
                    {futureRealAgentCount}
                  </div>
                </div>
                <div className="rounded-[var(--radius)] border border-black/10 bg-[#faf7f1] px-4 py-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-black/40">
                    Promote
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-black/80">
                    {summary.promoted}
                  </div>
                </div>
                <div className="rounded-[var(--radius)] border border-black/10 bg-[#faf7f1] px-4 py-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-black/40">
                    Create
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-black/80">
                    {summary.creates}
                  </div>
                </div>
                <div className="rounded-[var(--radius)] border border-black/10 bg-[#faf7f1] px-4 py-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-black/40">
                    Merge
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-black/80">
                    {summary.merges}
                  </div>
                </div>
                <div className="rounded-[var(--radius)] border border-black/10 bg-[#faf7f1] px-4 py-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-black/40">
                    Deferred
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-black/80">
                    {summary.deferred}
                  </div>
                </div>
              </div>

              <div className="rounded-[var(--radius)] border border-black/10 bg-[#faf7f1] px-4 py-4 text-sm text-black/60">
                {futureRealAgentCount > 0 ? (
                  <>
                    You&apos;re ready. One approved real agent bucket is enough to start
                    classification, and every deferred suggestion can wait.
                  </>
                ) : (
                  <>
                    You still need at least one real agent bucket. Promote a strong
                    suggested bucket or create one new bucket before continuing.
                  </>
                )}
              </div>

              <div className="space-y-2">
                {drafts.map((draft) => (
                  <div
                    key={draft.id}
                    className="flex flex-col gap-2 rounded-[var(--radius)] border border-black/10 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-black/80">{draft.draftName}</span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${actionTone(
                            draft.action,
                          )}`}
                        >
                          {actionLabel(draft.action)}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${audienceTone(
                            draft.audience,
                          )}`}
                        >
                          {audienceLabel(draft.audience)}
                        </span>
                      </div>
                      <p className="text-sm text-black/55">{draft.reason}</p>
                    </div>
                    {draft.action === "MERGE" && draft.mergeTargetBucketId ? (
                      <div className="text-sm text-black/45">
                        Into{" "}
                        {targetableBuckets.find(
                          (target) => target.id === draft.mergeTargetBucketId,
                        )?.label ?? "selected bucket"}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {applyState.kind !== "idle" ? (
                <div
                  className={`rounded-[var(--radius)] border px-4 py-3 text-sm ${
                    applyState.kind === "error"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-black/10 bg-white text-black/65"
                  }`}
                >
                  {applyState.message}
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-black/10 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-black/50">
              {STEP_LABELS[step].description}
            </div>
            <div className="flex flex-wrap gap-2">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={() => setStep((current) => Math.max(0, current - 1))}
                  className="inline-flex h-9 items-center rounded-[var(--radius)] border border-black/10 px-4 text-sm font-medium text-black/70 transition-colors hover:bg-black/[0.03]"
                >
                  Back
                </button>
              ) : null}
              {step < STEP_LABELS.length - 1 ? (
                <button
                  type="button"
                  disabled={!canContinueFromStarter}
                  onClick={() =>
                    setStep((current) =>
                      Math.min(STEP_LABELS.length - 1, current + 1),
                    )
                  }
                  className="inline-flex h-9 items-center rounded-[var(--radius)] bg-black px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!canStartClassification || applyState.kind === "saving" || applyState.kind === "running"}
                  onClick={() => void applyAndStart()}
                  className="inline-flex h-9 items-center rounded-[var(--radius)] bg-black px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {applyState.kind === "saving"
                    ? "Saving..."
                    : applyState.kind === "running"
                      ? "Starting..."
                      : "Save and start classification"}
                </button>
              )}
              <Link
                href="/buckets?advanced=1"
                className="inline-flex h-9 items-center rounded-[var(--radius)] border border-black/10 px-4 text-sm font-medium text-black/70 transition-colors hover:bg-black/[0.03]"
              >
                Open advanced editor
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
