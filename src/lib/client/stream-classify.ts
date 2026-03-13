export type ClassifyResult = {
  discoveredCount: number;
  processed: number;
  enriched: number;
  classified: number;
  skillsCreated: number;
  referencesAttached: number;
  triaged: number;
  bucketsRefreshed?: number;
  blocked?: boolean;
  needsBucketReview?: boolean;
  discoveryPendingCount?: number;
  pendingCount?: number;
  queuedMicroSkillCount?: number;
  dirtyBucketCount?: number;
  undecidedBucketCount?: number;
  estimatedCost?: number;
  budgetRemaining?: number;
  enrichmentWarning?: string;
  error?: string;
  done?: boolean;
};

const EMPTY_RESULT: ClassifyResult = {
  discoveredCount: 0,
  processed: 0,
  enriched: 0,
  classified: 0,
  skillsCreated: 0,
  referencesAttached: 0,
  triaged: 0,
  bucketsRefreshed: 0,
};

function mergeResults(total: ClassifyResult, next: ClassifyResult): ClassifyResult {
  return {
    ...total,
    ...next,
    discoveredCount: total.discoveredCount + (next.discoveredCount ?? 0),
    processed: total.processed + (next.processed ?? 0),
    enriched: total.enriched + (next.enriched ?? 0),
    classified: total.classified + (next.classified ?? 0),
    skillsCreated: total.skillsCreated + (next.skillsCreated ?? 0),
    referencesAttached: total.referencesAttached + (next.referencesAttached ?? 0),
    triaged: total.triaged + (next.triaged ?? 0),
    bucketsRefreshed:
      (total.bucketsRefreshed ?? 0) + (next.bucketsRefreshed ?? 0),
  };
}

/**
 * Streams a single classification pass, calling emitLog for each log line as it arrives.
 */
export async function streamClassify(
  emitLog: (message: string) => void,
  onBookmarkStep?: (bookmarkId: string, step: string) => void,
): Promise<ClassifyResult> {
  const res = await fetch("/api/classify", { method: "POST" });

  if (!res.body) {
    const text = await res.text();
    const lines = text.split("\n").filter(Boolean);
    let result: ClassifyResult = { ...EMPTY_RESULT };
    for (const line of lines) {
      const parsed = JSON.parse(line) as {
        log?: string;
        done?: boolean;
        error?: string;
        bookmarkId?: string;
        step?: string;
      };
      if (parsed.bookmarkId && parsed.step) {
        onBookmarkStep?.(parsed.bookmarkId, parsed.step);
      } else if (parsed.log) {
        emitLog(parsed.log);
      }
      if (parsed.done) {
        result = parsed as unknown as ClassifyResult;
      }
    }
    return result;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ClassifyResult = { ...EMPTY_RESULT };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) {
        continue;
      }

      try {
        const parsed = JSON.parse(line) as {
          log?: string;
          done?: boolean;
          error?: string;
          bookmarkId?: string;
          step?: string;
        };
        if (parsed.bookmarkId && parsed.step) {
          onBookmarkStep?.(parsed.bookmarkId, parsed.step);
        } else if (parsed.log) {
          emitLog(parsed.log);
        }
        if (parsed.done) {
          result = parsed as unknown as ClassifyResult;
        }
      } catch {
        // Skip malformed lines.
      }
    }

    if (done) {
      break;
    }
  }

  return result;
}

export async function drainClassification(
  emitLog: (message: string) => void,
  onBookmarkStep?: (bookmarkId: string, step: string) => void,
  onPassComplete?: () => void | Promise<void>,
): Promise<ClassifyResult> {
  let total = { ...EMPTY_RESULT };

  for (let pass = 1; pass <= 20; pass += 1) {
    if (pass > 1) {
      emitLog(`Continuing classification pass ${pass}...`);
    }

    const passResult = await streamClassify(emitLog, onBookmarkStep);
    total = mergeResults(total, passResult);

    await onPassComplete?.();

    if (passResult.error || passResult.blocked) {
      return total;
    }
    if (passResult.needsBucketReview) {
      return total;
    }

    const remainingWork =
      (passResult.discoveryPendingCount ?? 0) +
      (passResult.pendingCount ?? 0) +
      (passResult.queuedMicroSkillCount ?? 0) +
      (passResult.dirtyBucketCount ?? 0);
    const madeProgress =
      (passResult.discoveredCount ?? 0) +
      (passResult.processed ?? 0) +
      (passResult.skillsCreated ?? 0) +
      (passResult.referencesAttached ?? 0) +
      (passResult.bucketsRefreshed ?? 0);

    if (remainingWork <= 0 || madeProgress <= 0) {
      return total;
    }
  }

  emitLog("Stopping automatic classification after 20 passes.");
  return total;
}
