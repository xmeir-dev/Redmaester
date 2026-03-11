import Anthropic from "@anthropic-ai/sdk";

import { calculateAnthropicCostUsd, normalizeAnthropicUsage } from "@/lib/ai/pricing";
import { prisma } from "@/lib/db/prisma";
import { recordUsage } from "@/lib/domain/budget";
import { appConfig } from "@/lib/domain/config";

type ClassificationEntry = {
  classificationType: string;
  matchedSkillName: string | null;
  confidence: number;
  rationale: string | null;
};

type ContextItem = {
  tweetId: string;
  authorHandle: string;
  url: string;
  text: string;
  title?: string;
  classificationEntries: ClassificationEntry[];
  score: number;
  bookmarkedAt: Date;
};

type ContextResult = {
  items: ContextItem[];
  totalBookmarks: number;
  matchedBookmarks: number;
};

export type ChatAnswer = {
  answer: string;
  sources: Array<{ tweetId: string; url: string; authorHandle: string }>;
  usedModel: string;
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

const SYNONYM_MAP: Record<string, string[]> = {
  figma: ["figma", "figjam", "ui", "ux", "design", "component", "components", "autolayout", "auto", "layout", "prototype", "wireframe"],
  marketing: ["marketing", "growth", "distribution", "positioning", "messaging", "acquisition", "conversion", "seo", "ads"],
  growth: ["growth", "acquisition", "retention", "funnel", "distribution", "conversion"],
  product: ["product", "roadmap", "pmf", "feature", "launch", "pricing"],
  ai: ["ai", "agent", "agents", "llm", "model", "automation", "mcp", "rag"]
};

const EVIDENCE_LIMIT = Math.max(24, Math.floor(appConfig.chatEvidenceLimit));
const CHUNK_SIZE = Math.max(8, Math.floor(appConfig.chatChunkSize));
const MAX_CHUNKS = Math.max(1, Math.floor(appConfig.chatMaxChunks));

function cleanForPrompt(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function extractQuotedPhrases(text: string): string[] {
  const matches = Array.from(text.matchAll(/"([^"]+)"/g));
  return matches.map((match) => cleanForPrompt(match[1].toLowerCase(), 80)).filter((value) => value.length >= 3);
}

function uniqueTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens.map((token) => token.trim().toLowerCase()).filter(Boolean)));
}

function expandQueryTokens(tokens: string[]): string[] {
  const expanded = new Set<string>();

  for (const token of tokens) {
    expanded.add(token);

    if (token.endsWith("s") && token.length >= 4) {
      expanded.add(token.slice(0, -1));
    }

    for (const [key, related] of Object.entries(SYNONYM_MAP)) {
      if (token === key || token.includes(key) || key.includes(token)) {
        for (const item of related) {
          expanded.add(item);
        }
      }
    }
  }

  return Array.from(expanded).slice(0, 60);
}

function countContains(text: string, token: string): number {
  if (!text || !token) {
    return 0;
  }

  let count = 0;
  let start = 0;
  while (true) {
    const idx = text.indexOf(token, start);
    if (idx === -1) {
      break;
    }
    count += 1;
    start = idx + token.length;
    if (count >= 3) {
      break;
    }
  }

  return count;
}

function extractTitle(rawJson: string): string | undefined {
  if (!rawJson) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawJson) as {
      article?: { title?: string };
      card?: { title?: string };
      entities?: { urls?: Array<{ title?: string; expanded_url?: string }> };
      note_tweet?: { text?: string };
    };

    const title =
      parsed.article?.title ??
      parsed.card?.title ??
      parsed.entities?.urls?.[0]?.title ??
      parsed.note_tweet?.text;

    if (!title) {
      return undefined;
    }

    return cleanForPrompt(title, 220);
  } catch {
    return undefined;
  }
}

function scoreItem(
  item: {
    text: string;
    title?: string;
    classificationText: string;
    rationaleText: string;
    url: string;
    bookmarkedAt: Date;
  },
  queryTokens: string[],
  queryPhrases: string[]
): number {
  const text = item.text.toLowerCase();
  const title = (item.title ?? "").toLowerCase();
  const classifications = item.classificationText.toLowerCase();
  const rationales = item.rationaleText.toLowerCase();
  const url = item.url.toLowerCase();

  let score = 0;

  for (const token of queryTokens) {
    score += countContains(title, token) * 14;
    score += countContains(classifications, token) * 8;
    score += countContains(rationales, token) * 3;
    score += countContains(text, token) * 4;
    score += countContains(url, token) * 3;
  }

  for (const phrase of queryPhrases) {
    score += countContains(title, phrase) * 24;
    score += countContains(rationales, phrase) * 10;
    score += countContains(text, phrase) * 10;
  }

  const ageDays = Math.floor((Date.now() - item.bookmarkedAt.getTime()) / 86_400_000);
  if (ageDays <= 30) {
    score += 1;
  }

  return score;
}

function summarizeLocal(context: ContextItem[], question: string, totalBookmarks: number, matchedBookmarks: number): ChatAnswer {
  const top = context.slice(0, 8);

  if (top.length === 0) {
    return {
      answer: "No matching bookmarks were found yet. Run full sync or ask a broader question.",
      sources: [],
      usedModel: "local-fallback"
    };
  }

  const bullets = top
    .map((item, index) => {
      const titlePart = item.title ? ` title=${item.title};` : "";
      const classificationPart = item.classificationEntries.length > 0
        ? ` type=${item.classificationEntries[0].classificationType}${item.classificationEntries[0].matchedSkillName ? ` skill=${item.classificationEntries[0].matchedSkillName}` : ""}`
        : "";
      return `${index + 1}. [${item.tweetId}] @${item.authorHandle}:${titlePart} text=${item.text.slice(0, 180)}...${classificationPart}`;
    })
    .join("\n");

  return {
    answer:
      `Based on your bookmarks for "${question}":\n${bullets}` +
      `\n\nCoverage: scored all ${totalBookmarks} bookmarks, found ${matchedBookmarks} relevant, used top ${top.length}.`,
    sources: top.map((item) => ({
      tweetId: item.tweetId,
      url: item.url,
      authorHandle: item.authorHandle
    })),
    usedModel: "local-fallback"
  };
}

function buildHistoryBlock(history: ChatTurn[]): string {
  return history
    .slice(-8)
    .map((turn, index) => `${index + 1}. ${turn.role.toUpperCase()}: ${cleanForPrompt(turn.content, 400)}`)
    .join("\n");
}

function contextLine(item: ContextItem, index: number): string {
  const classification = item.classificationEntries[0];
  const classInfo = classification
    ? `type=${classification.classificationType}${classification.matchedSkillName ? ` skill=${classification.matchedSkillName}` : ""}`
    : "";

  return [
    `${index + 1}) tweet_id=${item.tweetId}`,
    `author=@${item.authorHandle}`,
    `url=${item.url}`,
    item.title ? `title=${cleanForPrompt(item.title, 180)}` : "",
    classInfo,
    `text=${cleanForPrompt(item.text, 420)}`,
    classification?.rationale ? `rationale=${cleanForPrompt(classification.rationale, 200)}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDirectPrompt(question: string, history: ChatTurn[], context: ContextItem[]): string {
  const historyBlock = buildHistoryBlock(history);
  const contextBlock = context.map((item, index) => contextLine(item, index)).join("\n\n");

  return [
    "You are Redmaester Assistant.",
    "Use only the provided evidence records.",
    "Give practical advice and cite tweet_ids.",
    "If the evidence is weak, say so.",
    "Do not use markdown tables.",
    historyBlock ? `Conversation so far:\n${historyBlock}` : "",
    "",
    `Question: ${question}`,
    "",
    "Evidence records:",
    contextBlock
  ]
    .filter(Boolean)
    .join("\n");
}

function splitChunks<T>(items: T[], chunkSize: number, maxChunks: number): T[][] {
  const limited = items.slice(0, chunkSize * maxChunks);
  const chunks: T[][] = [];

  for (let i = 0; i < limited.length; i += chunkSize) {
    chunks.push(limited.slice(i, i + chunkSize));
  }

  return chunks;
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

async function callAnthropic(prompt: string, maxTokens: number, operation: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create(
    {
      model: appConfig.chatModel,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }]
    },
    {
      timeout: appConfig.chatModelTimeoutMs
    }
  );

  const model = String(response.model ?? appConfig.chatModel);
  const usage = normalizeAnthropicUsage(response.usage);
  const amountUsd = calculateAnthropicCostUsd(model, usage);
  if (amountUsd > 0) {
    try {
      await recordUsage({
        operation: `${operation}:${model}`,
        amountUsd
      });
    } catch (error) {
      console.error("[chat] failed to record model usage:", error);
    }
  }

  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("timed out") || message.includes("timeout") || message.includes("abort");
}

function buildChunkPrompt(question: string, history: ChatTurn[], chunk: ContextItem[], chunkIndex: number, totalChunks: number): string {
  const historyBlock = buildHistoryBlock(history);
  const chunkBlock = chunk.map((item, index) => contextLine(item, index)).join("\n\n");

  return [
    "You are extracting evidence from bookmarks.",
    "Use only the records below.",
    "Return up to 8 bullet points.",
    "Each bullet must include a tweet_id and one concrete takeaway tied to the question.",
    "Keep bullets short and factual.",
    historyBlock ? `Conversation so far:\n${historyBlock}` : "",
    "",
    `Question: ${question}`,
    `Chunk ${chunkIndex + 1} of ${totalChunks}`,
    "",
    "Records:",
    chunkBlock
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFinalPrompt(
  question: string,
  history: ChatTurn[],
  chunkSummaries: string[],
  totalBookmarks: number,
  matchedBookmarks: number,
  examinedBookmarks: number
): string {
  const historyBlock = buildHistoryBlock(history);
  const summaryBlock = chunkSummaries.map((summary, index) => `Chunk ${index + 1}:\n${summary}`).join("\n\n");

  return [
    "You are Redmaester Assistant.",
    "Use only the evidence summaries below.",
    "Write a direct answer with specific recommendations.",
    "Cite tweet_ids where possible.",
    "If the evidence is narrow, explicitly say what is missing.",
    "Do not use markdown tables.",
    historyBlock ? `Conversation so far:\n${historyBlock}` : "",
    "",
    `Question: ${question}`,
    `Coverage stats: total_bookmarks=${totalBookmarks}, matched_bookmarks=${matchedBookmarks}, examined_bookmarks=${examinedBookmarks}`,
    "",
    "Evidence summaries:",
    summaryBlock
  ]
    .filter(Boolean)
    .join("\n");
}

async function synthesizeChunked(
  question: string,
  history: ChatTurn[],
  context: ContextItem[],
  totalBookmarks: number,
  matchedBookmarks: number
): Promise<{ answer: string; analyzedCount: number }> {
  const chunks = splitChunks(context, CHUNK_SIZE, MAX_CHUNKS);
  const summaries = await mapWithConcurrency(chunks, 3, async (chunk, index) => {
    const prompt = buildChunkPrompt(question, history, chunk, index, chunks.length);
    const summary = await callAnthropic(prompt, 520, "chat:chunk");
    return summary || "No strong evidence extracted from this chunk.";
  });

  const analyzedCount = chunks.flat().length;
  const finalPrompt = buildFinalPrompt(
    question,
    history,
    summaries,
    totalBookmarks,
    matchedBookmarks,
    analyzedCount
  );

  const answer = await callAnthropic(finalPrompt, 900, "chat:final");
  return { answer, analyzedCount };
}

async function collectContext(question: string, history: ChatTurn[]): Promise<ContextResult> {
  const historyQuery = history
    .filter((turn) => turn.role === "user")
    .slice(-4)
    .map((turn) => turn.content)
    .join(" ");

  const rawTokens = uniqueTokens([...tokenize(question), ...tokenize(historyQuery)]);
  const queryTokens = expandQueryTokens(rawTokens);
  const queryPhrases = extractQuotedPhrases(question);

  const [bookmarks, classifications] = await Promise.all([
    prisma.bookmark.findMany({
      orderBy: { bookmarkedAt: "desc" },
      select: {
        id: true,
        text: true,
        authorHandle: true,
        url: true,
        rawJson: true,
        bookmarkedAt: true,
      }
    }),
    prisma.bookmarkClassification.findMany({
      select: {
        bookmarkId: true,
        classificationType: true,
        confidence: true,
        rationale: true,
        matchedSkill: {
          select: { name: true }
        }
      }
    })
  ]);

  const classificationByBookmark = new Map<string, ClassificationEntry[]>();
  for (const c of classifications) {
    const entries = classificationByBookmark.get(c.bookmarkId) ?? [];
    entries.push({
      classificationType: c.classificationType,
      matchedSkillName: c.matchedSkill?.name ?? null,
      confidence: c.confidence,
      rationale: c.rationale
    });
    classificationByBookmark.set(c.bookmarkId, entries);
  }

  const scored: ContextItem[] = bookmarks.map((bookmark) => {
    const classificationEntries = (classificationByBookmark.get(bookmark.id) ?? []).sort((a, b) => b.confidence - a.confidence);
    const title = extractTitle(bookmark.rawJson);
    const classificationText = classificationEntries
      .map((e) => `${e.classificationType} ${e.matchedSkillName ?? ""}`)
      .join(" ");
    const rationaleText = classificationEntries
      .map((e) => e.rationale ?? "")
      .join(" ");

    const score = scoreItem(
      {
        text: bookmark.text,
        title,
        classificationText,
        rationaleText,
        url: bookmark.url,
        bookmarkedAt: bookmark.bookmarkedAt
      },
      queryTokens,
      queryPhrases
    );

    return {
      tweetId: bookmark.id,
      authorHandle: bookmark.authorHandle,
      url: bookmark.url,
      text: bookmark.text,
      title,
      classificationEntries,
      score,
      bookmarkedAt: bookmark.bookmarkedAt
    };
  });

  const matched = scored.filter((item) => item.score > 0);
  const matchedBookmarks = matched.length;

  const sorted = (matchedBookmarks > 0 ? matched : scored)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.bookmarkedAt.getTime() - a.bookmarkedAt.getTime();
    })
    .slice(0, EVIDENCE_LIMIT);

  return {
    items: sorted,
    totalBookmarks: bookmarks.length,
    matchedBookmarks
  };
}

function isBookmarkCountQuestion(question: string): boolean {
  const text = question.toLowerCase();
  return /how many/.test(text) && /(bookmark|bookmarks|saved tweets|saved posts|saved items)/.test(text);
}

function topSources(items: ContextItem[]): Array<{ tweetId: string; url: string; authorHandle: string }> {
  const seen = new Set<string>();
  const results: Array<{ tweetId: string; url: string; authorHandle: string }> = [];

  for (const item of items) {
    if (seen.has(item.tweetId)) {
      continue;
    }

    seen.add(item.tweetId);
    results.push({
      tweetId: item.tweetId,
      url: item.url,
      authorHandle: item.authorHandle
    });

    if (results.length >= 12) {
      break;
    }
  }

  return results;
}

export async function answerQuestion(question: string, history: ChatTurn[] = []): Promise<ChatAnswer> {
  const trimmed = question.trim();
  if (!trimmed) {
    return {
      answer: "Ask a question first.",
      sources: [],
      usedModel: "none"
    };
  }

  if (isBookmarkCountQuestion(trimmed)) {
    const total = await prisma.bookmark.count();
    return {
      answer: `You currently have ${total} synced bookmarks in Redmaester.`,
      sources: [],
      usedModel: "db-count"
    };
  }

  const contextResult = await collectContext(trimmed, history);
  const context = contextResult.items;

  if (context.length === 0) {
    return {
      answer: `No bookmarks available.`,
      sources: [],
      usedModel: "none"
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return summarizeLocal(context, trimmed, contextResult.totalBookmarks, contextResult.matchedBookmarks);
  }

  try {
    let answer = "";
    let analyzedCount = context.length;

    if (context.length <= CHUNK_SIZE * 2) {
      const directContext = context.slice(0, CHUNK_SIZE * 2);
      analyzedCount = directContext.length;
      const directPrompt = buildDirectPrompt(trimmed, history, directContext);
      answer = await callAnthropic(directPrompt, 900, "chat:direct");
    } else {
      try {
        const chunked = await synthesizeChunked(
          trimmed,
          history,
          context,
          contextResult.totalBookmarks,
          contextResult.matchedBookmarks
        );
        answer = chunked.answer;
        analyzedCount = chunked.analyzedCount;
      } catch (error) {
        if (isTimeoutError(error)) {
          console.error("[chat] chunked synthesis timed out, retrying with lean prompt");
          const leanContext = context.slice(0, Math.min(56, context.length));
          analyzedCount = leanContext.length;
          const leanPrompt = buildDirectPrompt(trimmed, history, leanContext);
          answer = await callAnthropic(leanPrompt, 780, "chat:lean");
        } else {
          throw error;
        }
      }
    }

    const coverageLine = `Coverage: scanned ${contextResult.totalBookmarks} bookmarks, matched ${contextResult.matchedBookmarks}, analyzed ${analyzedCount}.`;

    return {
      answer: `${answer || "No answer generated."}\n\n${coverageLine}`,
      sources: topSources(context),
      usedModel: appConfig.chatModel
    };
  } catch (error) {
    console.error("[chat] Anthropic request failed:", error);
    return summarizeLocal(context, trimmed, contextResult.totalBookmarks, contextResult.matchedBookmarks);
  }
}
