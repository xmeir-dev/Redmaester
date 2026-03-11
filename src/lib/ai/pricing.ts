import type { Usage } from "@anthropic-ai/sdk/resources/messages/messages";

type ModelRates = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
};

const TOKENS_PER_MILLION = 1_000_000;

const SONNET_4_RATES: ModelRates = {
  inputUsdPerMillion: 3,
  outputUsdPerMillion: 15,
  cacheWriteUsdPerMillion: 3.75,
  cacheReadUsdPerMillion: 0.3
};

const MODEL_RATE_TABLE: Array<{ match: RegExp; rates: ModelRates }> = [
  {
    match: /claude-opus-4(?:-1)?/i,
    rates: {
      inputUsdPerMillion: 15,
      outputUsdPerMillion: 75,
      cacheWriteUsdPerMillion: 18.75,
      cacheReadUsdPerMillion: 1.5
    }
  },
  { match: /claude-sonnet-4(?:-6|-5)?/i, rates: SONNET_4_RATES },
  { match: /claude-3-7-sonnet/i, rates: SONNET_4_RATES },
  { match: /claude-3-5-sonnet/i, rates: SONNET_4_RATES },
  {
    match: /claude-3-5-haiku/i,
    rates: {
      inputUsdPerMillion: 0.8,
      outputUsdPerMillion: 4,
      cacheWriteUsdPerMillion: 1,
      cacheReadUsdPerMillion: 0.08
    }
  },
  {
    match: /claude-3-haiku/i,
    rates: {
      inputUsdPerMillion: 0.25,
      outputUsdPerMillion: 1.25,
      cacheWriteUsdPerMillion: 0.3,
      cacheReadUsdPerMillion: 0.03
    }
  }
];

function normalizeTokenCount(value: number | null | undefined): number {
  if (!Number.isFinite(value) || !value || value < 0) {
    return 0;
  }

  return Math.floor(value);
}

function resolveRates(model: string): ModelRates {
  for (const entry of MODEL_RATE_TABLE) {
    if (entry.match.test(model)) {
      return entry.rates;
    }
  }

  return SONNET_4_RATES;
}

export type AnthropicUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export function normalizeAnthropicUsage(usage: Usage): AnthropicUsage {
  return {
    inputTokens: normalizeTokenCount(usage.input_tokens),
    outputTokens: normalizeTokenCount(usage.output_tokens),
    cacheCreationInputTokens: normalizeTokenCount(usage.cache_creation_input_tokens),
    cacheReadInputTokens: normalizeTokenCount(usage.cache_read_input_tokens)
  };
}

export function calculateAnthropicCostUsd(model: string, usage: AnthropicUsage): number {
  const rates = resolveRates(model);
  const inputCost = (usage.inputTokens / TOKENS_PER_MILLION) * rates.inputUsdPerMillion;
  const outputCost = (usage.outputTokens / TOKENS_PER_MILLION) * rates.outputUsdPerMillion;
  const cacheWriteCost =
    (usage.cacheCreationInputTokens / TOKENS_PER_MILLION) * rates.cacheWriteUsdPerMillion;
  const cacheReadCost =
    (usage.cacheReadInputTokens / TOKENS_PER_MILLION) * rates.cacheReadUsdPerMillion;

  return Number((inputCost + outputCost + cacheWriteCost + cacheReadCost).toFixed(6));
}
