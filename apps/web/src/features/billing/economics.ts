import { z } from 'zod';
import { economicsPlans } from './economics-input';

const micros = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const measurement = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['measured', 'estimated']),
    amountMicros: micros,
  }),
  z.strictObject({
    kind: z.literal('unknown'),
    reason: z.enum([
      'not_measured',
      'rate_missing',
      'allocation_missing',
      'outcome_unknown',
    ]),
  }),
]);
const instant = z.iso.datetime({ precision: 3 });
const categories = [
  'models',
  'speech',
  'recording',
  'broadcast',
  'storage',
  'paymentFees',
  'shared',
  'freeTierSubsidy',
] as const;
const report = z.strictObject({
  plan: z.enum(economicsPlans),
  startsAt: instant,
  endsAt: instant,
  floorBasisPoints: z.number().int().min(0).max(10000).nullable(),
  revenueAfterRefunds: measurement,
  costs: z.record(z.enum(categories), measurement),
});
const unknown = (
  reason:
    | 'invalid_input'
    | 'invalid_month'
    | 'future_month'
    | 'floor_missing'
    | 'measurements_missing'
    | 'total_overflow',
) => ({ kind: 'unknown' as const, reason });

function exactMonth(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  if (
    start.getUTCDate() !== 1 ||
    start.getUTCHours() !== 0 ||
    start.getUTCMinutes() !== 0 ||
    start.getUTCSeconds() !== 0 ||
    start.getUTCMilliseconds() !== 0
  )
    return false;
  start.setUTCMonth(start.getUTCMonth() + 1);
  return start.toISOString() === endsAt;
}

/** Consumes attributed measurements; it chooses neither rates nor revenue-allocation policy and never infers cost from Room capacity. */
export function evaluateMonthlyMargin(value: unknown, now: string) {
  const parsed = report.safeParse(value);
  if (!parsed.success || !instant.safeParse(now).success)
    return unknown('invalid_input');
  const input = parsed.data;
  if (!exactMonth(input.startsAt, input.endsAt))
    return unknown('invalid_month');
  if (Date.parse(now) < Date.parse(input.startsAt))
    return unknown('future_month');
  if (input.floorBasisPoints === null) return unknown('floor_missing');
  return assess(input, now, input.floorBasisPoints);
}

function readTotals(input: z.infer<typeof report>) {
  const costs = Object.values(input.costs);
  const known = costs.flatMap((cost) =>
    cost.kind === 'unknown' ? [] : [cost],
  );
  if (
    input.revenueAfterRefunds.kind === 'unknown' ||
    known.length !== categories.length
  )
    return unknown('measurements_missing');
  const total = known.reduce(
    (sum, cost) => sum + BigInt(cost.amountMicros),
    0n,
  );
  if (
    total > BigInt(Number.MAX_SAFE_INTEGER) ||
    total < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    return unknown('total_overflow');
  const revenue = BigInt(input.revenueAfterRefunds.amountMicros);
  return {
    kind: 'known',
    total,
    revenue,
    measured:
      known.every((cost) => cost.kind === 'measured') &&
      input.revenueAfterRefunds.kind === 'measured',
  } as const;
}

function assess(
  input: z.infer<typeof report>,
  now: string,
  floorBasisPoints: number,
) {
  const measuredTotals = readTotals(input);
  if (measuredTotals.kind === 'unknown') return measuredTotals;
  const { revenue, total, measured } = measuredTotals;
  const totals = {
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    revenueAfterRefundsMicros: Number(revenue),
    totalCostMicros: Number(total),
    floorBasisPoints,
  };
  if (revenue <= 0n)
    return {
      kind: 'no_ratio',
      reason: 'nonpositive_revenue',
      ...totals,
    } as const;
  const contribution = revenue - total;
  if (
    contribution > BigInt(Number.MAX_SAFE_INTEGER) ||
    contribution < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    return unknown('total_overflow');
  const completed = Date.parse(input.endsAt) <= Date.parse(now);
  const projection = { ...totals, contributionMicros: Number(contribution) };
  if (!completed || !measured)
    return {
      kind: 'estimate',
      reason: completed ? 'estimated_inputs' : 'open_month',
      ...projection,
    } as const;
  const below = contribution * 10000n < revenue * BigInt(floorBasisPoints);
  return { kind: below ? 'below_floor' : 'healthy', ...projection } as const;
}
