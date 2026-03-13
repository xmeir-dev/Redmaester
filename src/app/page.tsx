export const dynamic = "force-dynamic";

import { AppShell } from "@/components/app-shell";
import { BookmarkTable, type BookmarkTableRow } from "@/components/bookmark-table";
import { HomeFilters } from "@/components/home-filters";
import { ProfileMenu } from "@/components/profile-menu";
import { SiteHeader } from "@/components/site-header";
import { SyncButton } from "@/components/sync-button";
import { SyncLog } from "@/components/sync-log";
import { TerminalPanel } from "@/components/terminal-panel";
import { getBookmarksData, getDashboardData } from "@/lib/domain/queries";
import type { BookmarkStatusData } from "@/components/bookmark-table";

type ParsedMedia = {
  type?: string;
  url?: string;
  preview_image_url?: string;
  media_url_https?: string;
};

type ParsedBookmarkJson = {
  article?: { title?: string };
  note_tweet?: { text?: string };
  entities?: {
    urls?: Array<{
      url?: string;
      expanded_url?: string;
      display_url?: string;
    }>;
  };
  media?: ParsedMedia[];
  extended_entities?: { media?: ParsedMedia[] };
  includes?: { media?: ParsedMedia[] };
};

function formatTimeAgo(value: Date): string {
  const now = Date.now();
  const diffMs = Math.max(0, now - value.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (diffMs < minute) {
    return "just now";
  }

  if (diffMs < hour) {
    const minutes = Math.floor(diffMs / minute);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  if (diffMs < week) {
    const days = Math.floor(diffMs / day);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  if (diffMs < month) {
    const weeks = Math.floor(diffMs / week);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }

  if (diffMs < year) {
    const months = Math.floor(diffMs / month);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }

  const years = Math.floor(diffMs / year);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function formatAbsoluteDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(value);
}

function formatUsd(value: number): string | React.ReactNode {
  if (value > 0 && value < 0.01) {
    return <><span className="text-black/30">&lt; </span>$0.01</>;
  }
  return `$${value.toFixed(2)}`;
}

function collectPhotoMedia(parsed: ParsedBookmarkJson): ParsedMedia[] {
  const candidates = [
    ...(parsed.media ?? []),
    ...(parsed.extended_entities?.media ?? []),
    ...(parsed.includes?.media ?? [])
  ];

  return candidates.filter((entry): entry is ParsedMedia => entry.type === "photo");
}

function collectPhotoTokens(parsed: ParsedBookmarkJson, photoMedia: ParsedMedia[]): string[] {
  const tokens = new Set<string>();

  for (const media of photoMedia) {
    if (media.url) {
      tokens.add(media.url);
    }
  }

  for (const urlEntity of parsed.entities?.urls ?? []) {
    const display = urlEntity.display_url?.toLowerCase() ?? "";
    const expanded = urlEntity.expanded_url?.toLowerCase() ?? "";
    const looksLikePhoto = display.startsWith("pic.x.com") || expanded.includes("/photo/");
    if (!looksLikePhoto) {
      continue;
    }

    if (urlEntity.url) {
      tokens.add(urlEntity.url);
    }

    if (urlEntity.expanded_url) {
      tokens.add(urlEntity.expanded_url);
    }
  }

  return Array.from(tokens);
}

function stripTokens(text: string, tokens: string[]): string {
  if (!tokens.length) {
    return text;
  }

  let output = text;
  for (const token of tokens) {
    if (!token) {
      continue;
    }
    output = output.split(token).join(" ");
  }

  return output.replace(/\s+/g, " ").trim();
}

function parseBookmarkMeta(
  rawJson: string,
  fallbackText: string
): {
  isXArticle: boolean;
  articleTitle?: string;
  displayText: string;
  hasPhotoAttachment: boolean;
  photoUrls: string[];
} {
  const defaultMeta = {
    isXArticle: false,
    displayText: fallbackText,
    hasPhotoAttachment: false,
    photoUrls: [] as string[]
  };

  try {
    const parsed = JSON.parse(rawJson) as ParsedBookmarkJson;
    const photoMedia = collectPhotoMedia(parsed);
    const photoTokens = collectPhotoTokens(parsed, photoMedia);
    const sourceText = parsed.note_tweet?.text?.trim() || fallbackText;
    const displayText = photoTokens.length > 0 ? stripTokens(sourceText, photoTokens) : sourceText;

    const title = parsed.article?.title?.trim();
    const photoUrls = Array.from(
      new Set(
        photoMedia
          .map((media) => media.preview_image_url ?? media.media_url_https)
          .filter((url): url is string => Boolean(url))
      )
    );

    return {
      isXArticle: Boolean(title),
      articleTitle: title || undefined,
      displayText,
      hasPhotoAttachment: photoMedia.length > 0 || photoTokens.length > 0,
      photoUrls
    };
  } catch {
    return defaultMeta;
  }
}

type ContentTypeFilter = "all" | "article" | "post";
type ClassificationStatusFilter = "all" | "micro_skill" | "reference" | "triage" | "ignored" | "pending";

type HomeSearchParams = {
  q?: string;
  filter?: string;
  type?: string;
  status?: string;
  bucket?: string;
};

function toTypeFilter(value: string | undefined): ContentTypeFilter {
  switch (value) {
    case "article":
    case "post":
      return value;
    default:
      return "all";
  }
}

function toStatusFilter(value: string | undefined): ClassificationStatusFilter {
  switch (value) {
    case "skill":
    case "micro_skill":
    case "reference":
    case "triage":
    case "ignored":
    case "pending":
      return value === "skill" ? "micro_skill" : value;
    default:
      return "all";
  }
}

function parseLegacyFilter(value: string | undefined): {
  type: ContentTypeFilter;
  status: ClassificationStatusFilter;
} {
  switch (value) {
    case "article":
    case "post":
      return { type: value, status: "all" };
    case "skill":
      return { type: "all", status: "micro_skill" };
    case "micro_skill":
    case "reference":
    case "triage":
    case "ignored":
    case "pending":
      return { type: "all", status: value };
    default:
      return { type: "all", status: "all" };
  }
}

type BookmarkFromQuery = Awaited<ReturnType<typeof getBookmarksData>>[number];

function deriveStatus(bookmark: BookmarkFromQuery): BookmarkStatusData {
  const classification = bookmark.classifications;
  const triageItems = bookmark.triageItems;
  const primaryBucketAudience = bookmark.bucketAssignments[0]?.bucket.audience;

  let badge: BookmarkStatusData["badge"] = "Pending";
  if (classification) {
    const action = classification.action;
    if (action === "queued_micro_skill") {
      badge = "Micro-skill";
    } else if (classification.fallback && triageItems.length === 0) {
      badge = "Pending";
    } else if (action === "created_micro_skill" || action === "updated_micro_skill" || action === "user_approved") {
      badge = "Micro-skill";
    } else if (action === "attached_reference") {
      badge = "Reference";
    } else if (triageItems.length > 0 || action === "staged_for_review") {
      badge = "Triaged";
    } else if (classification.roleType === "IGNORE" || classification.classificationType === "ignore" || action === "no_action") {
      badge = "Ignored";
    } else {
      badge = "Pending";
    }
  } else if (primaryBucketAudience === "PERSONAL") {
    badge = "Human";
  } else if (triageItems.length > 0) {
    badge = "Triaged";
  }

  const enrichments = bookmark.enrichments.map((e) => ({
    url: e.url,
    title: e.title,
    method: e.fetchMethod,
    error: e.fetchError,
    contentLength: e.contentLength,
  }));

  const classificationData = classification
    ? {
        type: classification.classificationType,
        roleType: classification.roleType,
        action: classification.action,
        confidence: classification.confidence,
        rationale: classification.rationale,
        bucketName: classification.bucket?.displayName ?? classification.bucket?.name ?? null,
        skillName: classification.targetSkill?.name ?? classification.extractedSkillName ?? null,
        fallback: classification.fallback,
      }
    : null;

  const firstTriage = triageItems[0];
  const triage = firstTriage
    ? { reason: firstTriage.reason, details: firstTriage.details }
    : null;

  return { badge, enrichments, classification: classificationData, triage };
}

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<HomeSearchParams>;
}) {
  const params = await searchParams;
  const data = await getDashboardData();
  const bookmarks = await getBookmarksData();
  const isConnected = data.xConnection.connected;
  const username = data.xConnection.username;
  const displayName = data.xConnection.displayName;
  const query = (params.q ?? "").trim().toLowerCase();
  const legacy = parseLegacyFilter(params.filter);
  const activeType = toTypeFilter(params.type ?? (legacy.type !== "all" ? legacy.type : undefined));
  const activeStatus = toStatusFilter(
    params.status ?? (legacy.status !== "all" ? legacy.status : undefined)
  );

  const rows = bookmarks.map((bookmark) => {
    const isTriaged = bookmark.triageItems.length > 0;
    const classification = bookmark.classifications;
    const primaryBucketAudience = bookmark.bucketAssignments[0]?.bucket.audience;
    const bucketNames = bookmark.bucketAssignments.map((assignment) => assignment.bucket.displayName);
    const meta = parseBookmarkMeta(bookmark.rawJson, bookmark.text);
    const status: ClassificationStatusFilter = classification
      ? classification.fallback && !isTriaged
        ? "pending"
        : classification.roleType === "MICRO_SKILL" || classification.action === "created_micro_skill" || classification.action === "updated_micro_skill"
        ? "micro_skill"
        : classification.roleType === "REFERENCE" || classification.classificationType === "reference"
          ? "reference"
          : isTriaged
            ? "triage"
            : classification.roleType === "IGNORE" || classification.classificationType === "ignore"
              ? "ignored"
              : "pending"
      : primaryBucketAudience === "PERSONAL"
        ? "ignored"
      : isTriaged
        ? "triage"
        : "pending";
    const type: "article" | "post" = meta.isXArticle ? "article" : "post";

    return {
      bookmark,
      bucketNames,
      meta,
      status,
      type
    };
  });

  const buckets = Array.from(new Set(rows.flatMap((row) => row.bucketNames))).sort((a, b) => a.localeCompare(b));
  const activeBucket = params.bucket && buckets.includes(params.bucket) ? params.bucket : "";

  const filteredRows = rows.filter((row) => {
    if (activeType !== "all" && row.type !== activeType) {
      return false;
    }

    if (activeStatus !== "all" && row.status !== activeStatus) {
      return false;
    }

    if (activeBucket && !row.bucketNames.includes(activeBucket)) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = [
      row.bookmark.text,
      row.bookmark.authorHandle,
      row.bookmark.authorName ?? "",
      row.bookmark.url,
      row.bookmark.id,
      row.meta.articleTitle ?? "",
      row.bucketNames.join(" "),
      row.bookmark.classifications?.targetSkill?.name ?? ""
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });

  const tableRows: BookmarkTableRow[] = filteredRows.map(
    ({ bookmark, meta, type }) => {
      const fullTitle = (
        meta.articleTitle ??
        meta.displayText ??
        bookmark.text
      )
        .replace(/\s+/g, " ")
        .trim();
      const bookmarkedDate = new Date(bookmark.bookmarkedAt);

      return {
        id: bookmark.id,
        url: bookmark.url,
        title: fullTitle,
        type,
        dateLabel: formatTimeAgo(bookmarkedDate),
        dateTooltip: formatAbsoluteDate(bookmarkedDate),
        status: deriveStatus(bookmark)
      };
    }
  );

  return (
    <AppShell
      header={
        <SiteHeader
          brand={
            <span className="inline-flex items-center gap-2.5">
              <svg width="24" height="22" viewBox="0 0 20 18" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
                <rect x="0" y="0" width="2" height="14" fill="#c0392b" />
                <rect x="2" y="2" width="2" height="14" fill="#e74c3c" />
                <rect x="4" y="4" width="2" height="14" fill="#e74c3c" />
                <rect x="6" y="6" width="2" height="12" fill="#e74c3c" />
                <rect x="8" y="8" width="2" height="10" fill="#922b21" />
                <rect x="10" y="8" width="2" height="10" fill="#922b21" />
                <rect x="12" y="6" width="2" height="12" fill="#e74c3c" />
                <rect x="14" y="4" width="2" height="14" fill="#e74c3c" />
                <rect x="16" y="2" width="2" height="14" fill="#e74c3c" />
                <rect x="18" y="0" width="2" height="14" fill="#c0392b" />
              </svg>
              <span style={{ fontFamily: "'Pixelify Sans', sans-serif", fontWeight: 700, fontSize: "18px", letterSpacing: "1px" }}><span className="text-black">Red</span><span className="text-[#c0392b]">maester</span></span>
            </span>
          }
          stats={[
            { label: "Bookmarks", value: data.metrics.bookmarkCount.toLocaleString() },
            { label: "Buckets", value: data.metrics.bucketCount.toLocaleString() },
            { label: "Skills", value: data.metrics.skillCount.toLocaleString() },
            { label: "References", value: data.metrics.referenceCount.toLocaleString() },
            { label: "Pending", value: data.metrics.pendingClassificationCount.toLocaleString() },
            { label: "Cost", value: formatUsd(data.metrics.monthSpend) },
            { label: "Budget left", value: formatUsd(data.metrics.budgetRemaining) },
          ]}
          actions={
            <ProfileMenu
              connected={isConnected}
              username={username}
              displayName={displayName}
              hasBookmarks={bookmarks.length > 0}
            />
          }
        />
      }
    >
      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0 space-y-4">
          {data.metrics.needsBucketOnboarding ? (
            <div className="rounded-[var(--radius)] border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900/80">
              <span className="font-medium">
                Guided bucket setup is still waiting on your first real agent bucket
              </span>
              {" before agent classification can continue. "}
              <a href="/buckets?onboarding=1" className="underline underline-offset-2">
                Open guided setup
              </a>
            </div>
          ) : null}
          {bookmarks.length > 0 && (
            <HomeFilters
              title="My bookmarks"
              query={params.q ?? ""}
              typeFilter={activeType}
              statusFilter={activeStatus}
              bucketFilter={activeBucket}
              buckets={buckets}
              resultsCount={filteredRows.length}
              totalCount={bookmarks.length}
            />
          )}
          <SyncLog />
          {bookmarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="text-black/20 text-5xl mb-4">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
              </div>
              <h3 className="text-lg font-medium text-black/70 mb-1">No bookmarks yet</h3>
              <p className="text-sm text-black/40 mb-6 max-w-sm">
                {isConnected
                  ? "Run an initial pull to import the latest 500 bookmarks, approve one starter agent bucket, and then start agent classification."
                  : "Connect your X account to import your bookmarks."}
              </p>
              {isConnected ? (
                <SyncButton />
              ) : (
                <a
                  href="/api/auth/x/start"
                  className="inline-flex h-9 items-center rounded-[var(--radius)] bg-black px-5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
                >
                  Connect X
                </a>
              )}
            </div>
          ) : (
            <BookmarkTable
              rows={tableRows}
              totalCount={bookmarks.length}
              initialVisible={30}
              loadStep={10}
            />
          )}
        </div>
        {bookmarks.length > 0 && <TerminalPanel />}
      </div>
    </AppShell>
  );
}
