import { beforeEach, describe, expect, it, vi } from "vitest";

const aggregateMock = vi.fn();
const createMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    modelUsage: {
      aggregate: (...args: unknown[]) => aggregateMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

import { canSpend, getCurrentMonthSpend, recordUsage } from "./budget";

beforeEach(() => {
  aggregateMock.mockReset();
  createMock.mockReset();
});

describe("getCurrentMonthSpend", () => {
  it("returns the summed cost for the current month, excluding fallback-router rows", async () => {
    aggregateMock.mockResolvedValue({ _sum: { estimatedCostUsd: 12.5 } });

    const spend = await getCurrentMonthSpend();

    expect(spend).toBe(12.5);
    expect(aggregateMock).toHaveBeenCalledTimes(1);
    const call = aggregateMock.mock.calls[0][0];
    expect(call.where.NOT).toEqual({
      operation: { startsWith: "route:fallback-keyword-router" },
    });
  });

  it("returns 0 when no usage has been recorded yet", async () => {
    aggregateMock.mockResolvedValue({ _sum: { estimatedCostUsd: null } });

    await expect(getCurrentMonthSpend()).resolves.toBe(0);
  });
});

describe("canSpend", () => {
  it("allows a spend that keeps the month at or under the $30 default budget", async () => {
    aggregateMock.mockResolvedValue({ _sum: { estimatedCostUsd: 10 } });

    await expect(canSpend(5)).resolves.toBe(true); // 10 + 5 <= 30
  });

  it("blocks a spend that would push the month over budget", async () => {
    aggregateMock.mockResolvedValue({ _sum: { estimatedCostUsd: 28 } });

    await expect(canSpend(5)).resolves.toBe(false); // 28 + 5 > 30
  });
});

describe("recordUsage", () => {
  it("writes a usage row for a positive amount, tagged to the current month", async () => {
    await recordUsage({ operation: "classify:bookmark", amountUsd: 0.03 });

    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0];
    expect(call.data.operation).toBe("classify:bookmark");
    expect(call.data.estimatedCostUsd).toBe(0.03);
    expect(call.data.monthKey).toMatch(/^\d{4}-\d{2}$/);
  });

  it("skips writing when the amount is zero, negative, or not finite", async () => {
    await recordUsage({ operation: "noop", amountUsd: 0 });
    await recordUsage({ operation: "noop", amountUsd: -1 });
    await recordUsage({ operation: "noop", amountUsd: Number.NaN });

    expect(createMock).not.toHaveBeenCalled();
  });
});
