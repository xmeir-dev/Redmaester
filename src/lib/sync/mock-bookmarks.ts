import type { BookmarkInput } from "@/lib/domain/types";

const now = Date.now();

export const mockBookmarks: BookmarkInput[] = [
  {
    id: "1890000000000000101",
    text: "If your onboarding asks users 8 questions before value, you are delaying retention. Compress setup to under 90 seconds.",
    authorHandle: "maria_builds",
    authorName: "Maria Chen",
    url: "https://x.com/maria_builds/status/1890000000000000101",
    bookmarkedAt: new Date(now - 5 * 60 * 1000),
    rawJson: { source: "mock" }
  },
  {
    id: "1890000000000000102",
    text: "Tooling note: run evals before changing your model provider. Most quality regressions look like speed improvements at first.",
    authorHandle: "infra_sam",
    authorName: "Samir Noor",
    url: "https://x.com/infra_sam/status/1890000000000000102",
    bookmarkedAt: new Date(now - 12 * 60 * 1000),
    rawJson: { source: "mock" }
  },
  {
    id: "1890000000000000103",
    text: "Distribution experiment: creator partnerships outperformed paid social CAC by 43% over six weeks.",
    authorHandle: "growthopsleo",
    authorName: "Leo F.",
    url: "https://x.com/growthopsleo/status/1890000000000000103",
    bookmarkedAt: new Date(now - 23 * 60 * 1000),
    rawJson: { source: "mock" }
  }
];
