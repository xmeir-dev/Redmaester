import { prisma } from "@/lib/db/prisma";
import { appConfig, currentMonthKey } from "@/lib/domain/config";

export async function getCurrentMonthSpend(): Promise<number> {
  const monthKey = currentMonthKey();
  const aggregate = await prisma.modelUsage.aggregate({
    _sum: { estimatedCostUsd: true },
    where: {
      monthKey,
      NOT: {
        operation: {
          startsWith: "route:fallback-keyword-router"
        }
      }
    }
  });

  return aggregate._sum.estimatedCostUsd ?? 0;
}

export async function canSpend(amountUsd: number): Promise<boolean> {
  const current = await getCurrentMonthSpend();
  return current + amountUsd <= appConfig.monthlyBudgetUsd;
}

export async function recordUsage(input: { operation: string; amountUsd: number }): Promise<void> {
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) {
    return;
  }

  await prisma.modelUsage.create({
    data: {
      monthKey: currentMonthKey(),
      operation: input.operation,
      estimatedCostUsd: input.amountUsd
    }
  });
}
