import { evaluateMonthlyMargin } from './economics';
import {
  allocateEconomics,
  missingEconomics,
  priceModelUsage,
  sumEconomics,
} from './economics-cost';
import {
  economicsCategories,
  economicsInput,
  economicsInstant,
  economicsPlans,
  type EconomicsInput,
  type EconomicsPlan,
} from './economics-input';

const unique = (values: readonly (number | string)[]) =>
  new Set(values).size === values.length;
function coherent(input: EconomicsInput, now: string) {
  const recognized = [...input.revenue, ...input.costs];
  return (
    unique(input.revenue.map((r) => r.sequence)) &&
    unique([...input.costs, ...input.modelUsage].map((r) => r.sequence)) &&
    unique(input.coverage.map((r) => `${r.plan}:${r.category}`)) &&
    unique(input.revenueCoverage.map((r) => r.plan)) &&
    unique(input.volume.map((r) => `${r.plan}:${r.feature}`)) &&
    recognized.every(
      (r) =>
        /^\d{4}-\d{2}-01T00:00:00\.000Z$/.test(r.sourceMonth) &&
        r.sourceMonth <= r.observedAt &&
        r.observedAt <= now,
    ) &&
    input.revenue.every(
      (r) =>
        r.kind !== 'refund' ||
        r.money.kind === 'unknown' ||
        r.money.amountMicros >= 0,
    ) &&
    input.costs.every(
      (r) =>
        r.allocation.shares.reduce((n, s) => n + s.basisPoints, 0) === 10000 &&
        unique(r.allocation.shares.map((s) => s.plan)) &&
        (r.allocation.rule !== 'free_subsidy' ||
          r.category === 'freeTierSubsidy') &&
        (r.allocation.rule !== 'equal_share' ||
          Math.max(...r.allocation.shares.map((s) => s.basisPoints)) -
            Math.min(...r.allocation.shares.map((s) => s.basisPoints)) <=
            1) &&
        (r.allocation.rule !== 'direct' || r.allocation.shares.length === 1),
    ) &&
    input.modelUsage.every(
      (r) =>
        r.occurredAt <= r.throughAt &&
        r.throughAt <= r.observedAt &&
        r.observedAt <= now,
    ) &&
    input.rates.every(
      (r) =>
        r.observedAt <= now &&
        (r.effectiveUntil === null || r.effectiveFrom < r.effectiveUntil),
    )
  );
}
function reportPlan(input: EconomicsInput, plan: EconomicsPlan, now: string) {
  const revenues = input.revenue
    .filter((r) => r.plan === plan && r.sourceMonth === input.startsAt)
    .map((r) =>
      r.money.kind === 'unknown'
        ? r.money
        : {
            ...r.money,
            amountMicros: r.money.amountMicros * (r.kind === 'refund' ? -1 : 1),
          },
    );
  const revenueCoverage = input.revenueCoverage.find((r) => r.plan === plan);
  const revenueAfterRefunds = revenueCoverage
    ? sumEconomics(revenues, revenueCoverage.kind === 'measured')
    : missingEconomics('not_measured');
  const allocated = input.costs
    .filter((r) => r.sourceMonth === input.startsAt)
    .flatMap((r) =>
      allocateEconomics(r)
        .filter((s) => s.plan === plan)
        .map((s) => ({ category: r.category, money: s.money })),
    );
  const modelCosts = input.modelUsage
    .filter(
      (r) =>
        r.plan === plan &&
        r.occurredAt >= input.startsAt &&
        r.occurredAt < input.endsAt,
    )
    .map((r) => priceModelUsage(r, input.rates));
  const costs = Object.fromEntries(
    economicsCategories.map((category) => {
      const coverage = input.coverage.find(
        (r) => r.plan === plan && r.category === category,
      );
      const values = [
        ...allocated.filter((r) => r.category === category).map((r) => r.money),
        ...(category === 'models' ? modelCosts : []),
      ];
      return [
        category,
        coverage
          ? sumEconomics(values, coverage.kind === 'measured')
          : missingEconomics('not_measured'),
      ];
    }),
  );
  return {
    revenueAfterRefunds,
    costs,
    margin: evaluateMonthlyMargin(
      {
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        floorBasisPoints: input.floorBasisPoints,
        plan,
        revenueAfterRefunds,
        costs,
      },
      now,
    ),
  };
}
/** Aggregate-only source data. A missing collection receipt is unknown, never an empty measured category. */
export function buildEconomicsReport(value: unknown, now: string) {
  const parsed = economicsInput.safeParse(value);
  if (
    !parsed.success ||
    !economicsInstant.safeParse(now).success ||
    !coherent(parsed.data, now)
  )
    return { kind: 'invalid', reason: 'invalid_input' } as const;
  const input = parsed.data;
  const plans = {
    free: reportPlan(input, 'free', now),
    beta: reportPlan(input, 'beta', now),
    premium: reportPlan(input, 'premium', now),
  };
  return {
    kind: 'report',
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    observedAt: now,
    plans,
    volume: input.volume,
    sources: {
      revenue: input.revenue,
      costs: input.costs,
      modelUsage: input.modelUsage,
      rates: input.rates,
      coverage: input.coverage,
      revenueCoverage: input.revenueCoverage,
    },
    plansReported: economicsPlans,
  } as const;
}
