import { describe, expect, it } from "vitest";
import { calculateAnthropicCostUsd, normalizeAnthropicUsage } from "./pricing";

describe("normalizeAnthropicUsage", () => {
  it("defaults every field to 0 when usage is missing", () => {
    expect(normalizeAnthropicUsage(null)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(normalizeAnthropicUsage(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  it("floors fractional counts and clamps negative or non-finite counts to 0", () => {
    const usage = normalizeAnthropicUsage({
      input_tokens: 100.9,
      output_tokens: -5,
      cache_creation_input_tokens: Number.NaN,
      cache_read_input_tokens: 40,
    } as never);

    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 40,
    });
  });
});

describe("calculateAnthropicCostUsd", () => {
  const oneMillionEach = {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };

  it("prices a claude-opus-4 model at the opus rate ($15 in + $75 out per million)", () => {
    expect(calculateAnthropicCostUsd("claude-opus-4-20250101", oneMillionEach)).toBe(90);
  });

  it("prices a claude-3-5-haiku model at the haiku rate ($0.80 in + $4 out per million)", () => {
    expect(calculateAnthropicCostUsd("claude-3-5-haiku-20241022", oneMillionEach)).toBe(4.8);
  });

  it("falls back to sonnet-4 rates for an unrecognized model name", () => {
    expect(calculateAnthropicCostUsd("some-unreleased-model", oneMillionEach)).toBe(18);
  });

  it("accounts for cache write and cache read tokens", () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
    };

    // sonnet-4 rates: $3.75 cache write + $0.30 cache read per million
    expect(calculateAnthropicCostUsd("claude-sonnet-4-6", usage)).toBe(4.05);
  });
});
