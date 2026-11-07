import type { EconomicsInput, EconomicsMoney } from './economics-input';

export const missingEconomics = (
  reason:
    'not_measured' | 'rate_missing' | 'allocation_missing' | 'outcome_unknown',
): EconomicsMoney => ({ kind: 'unknown', reason });
export function sumEconomics(
  values: readonly EconomicsMoney[],
  measured = true,
): EconomicsMoney {
  const unknown = values.find((v) => v.kind === 'unknown');
  if (unknown) return unknown;
  const sum = values.reduce(
    (total, v) => total + (v.kind === 'unknown' ? 0n : BigInt(v.amountMicros)),
    0n,
  );
  if (
    sum > BigInt(Number.MAX_SAFE_INTEGER) ||
    sum < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    return missingEconomics('not_measured');
  return {
    kind:
      measured && values.every((v) => v.kind === 'measured')
        ? 'measured'
        : 'estimated',
    amountMicros: Number(sum),
  };
}
/** Largest-remainder allocation conserves signed micro-units across all plans. */
export function allocateEconomics(cost: EconomicsInput['costs'][number]) {
  const { shares } = cost.allocation;
  if (cost.money.kind === 'unknown')
    return shares.map((share) => ({ plan: share.plan, money: cost.money }));
  const amount = BigInt(cost.money.amountMicros),
    sign = amount < 0n ? -1n : 1n;
  const absolute = amount * sign;
  const pieces = shares.map((s, index) => ({
    ...s,
    index,
    whole: (absolute * BigInt(s.basisPoints)) / 10000n,
    remainder: (absolute * BigInt(s.basisPoints)) % 10000n,
  }));
  const residual = Number(
    absolute - pieces.reduce((sum, p) => sum + p.whole, 0n),
  );
  const order = [...pieces]
    .sort((a, b) => Number(b.remainder - a.remainder) || a.index - b.index)
    .map((p) => p.index);
  const kind = cost.money.kind;
  return pieces.map((p) => ({
    plan: p.plan,
    money: {
      kind,
      amountMicros: Number(
        sign * (p.whole + (order.indexOf(p.index) < residual ? 1n : 0n)),
      ),
    },
  }));
}
type ModelUsage = EconomicsInput['modelUsage'][number];
function hasTokenMeasurements(
  usage: ModelUsage,
): usage is ModelUsage & { inputTokens: number; outputTokens: number } {
  return (
    usage.inputTokens !== null &&
    usage.outputTokens !== null &&
    usage.evidence !== 'unknown' &&
    (usage.evidence !== 'provider_response' ||
      usage.inputTokens !== 0 ||
      usage.outputTokens !== 0)
  );
}
export function priceModelUsage(
  usage: ModelUsage,
  rates: EconomicsInput['rates'],
): EconomicsMoney {
  if (!hasTokenMeasurements(usage)) return missingEconomics('outcome_unknown');
  const candidates = rates.filter(
    (r) =>
      r.model === usage.model &&
      r.provider === usage.provider &&
      r.effectiveFrom <= usage.throughAt &&
      (r.effectiveUntil === null || usage.occurredAt < r.effectiveUntil),
  );
  if (candidates.length !== 1) return missingEconomics('rate_missing');
  const rate = candidates[0]!;
  if (
    rate.effectiveFrom > usage.occurredAt ||
    (rate.effectiveUntil !== null && rate.effectiveUntil <= usage.throughAt)
  )
    return missingEconomics('rate_missing');
  const numerator =
    BigInt(usage.inputTokens) * BigInt(rate.inputMicrosPerMillion) +
    BigInt(usage.outputTokens) * BigInt(rate.outputMicrosPerMillion);
  const amount = (numerator + 999999n) / 1000000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    return missingEconomics('not_measured');
  return {
    kind: rate.provenance === 'billed_rate' ? 'measured' : 'estimated',
    amountMicros: Number(amount),
  };
}
