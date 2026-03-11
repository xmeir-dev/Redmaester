export type ClassifyResult = {
  processed: number;
  enriched: number;
  classified: number;
  skillsCreated: number;
  referencesAttached: number;
  triaged: number;
  blocked?: boolean;
  pendingCount?: number;
  estimatedCost?: number;
  budgetRemaining?: number;
  enrichmentWarning?: string;
  error?: string;
  done?: boolean;
};

/**
 * Streams the classification pipeline response, calling emitLog for each
 * log line as it arrives. Returns the final result object.
 */
export async function streamClassify(
  emitLog: (message: string) => void,
  onBookmarkStep?: (bookmarkId: string, step: string) => void,
): Promise<ClassifyResult> {
  const res = await fetch("/api/classify", { method: "POST" });

  if (!res.body) {
    // Fallback: no streaming support — read as text
    const text = await res.text();
    const lines = text.split("\n").filter(Boolean);
    let result: ClassifyResult = { processed: 0, enriched: 0, classified: 0, skillsCreated: 0, referencesAttached: 0, triaged: 0 };
    for (const line of lines) {
      const parsed = JSON.parse(line) as { log?: string; done?: boolean; error?: string; bookmarkId?: string; step?: string };
      if (parsed.bookmarkId && parsed.step) {
        onBookmarkStep?.(parsed.bookmarkId, parsed.step);
      } else if (parsed.log) {
        emitLog(parsed.log);
      }
      if (parsed.done) result = parsed as unknown as ClassifyResult;
    }
    return result;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ClassifyResult = { processed: 0, enriched: 0, classified: 0, skillsCreated: 0, referencesAttached: 0, triaged: 0 };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      try {
        const parsed = JSON.parse(line) as { log?: string; done?: boolean; error?: string; bookmarkId?: string; step?: string };
        if (parsed.bookmarkId && parsed.step) {
          onBookmarkStep?.(parsed.bookmarkId, parsed.step);
        } else if (parsed.log) {
          emitLog(parsed.log);
        }
        if (parsed.done) {
          result = parsed as unknown as ClassifyResult;
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (done) break;
  }

  return result;
}
