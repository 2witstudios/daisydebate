import type { Database } from '@daisy/db';

type Page = Awaited<
  ReturnType<ReturnType<Database['billingSubscriptionStaleness']>['sample']>
>;
export type SubscriptionFreshnessFacts = Omit<
  Page,
  'throughId' | 'afterId' | 'exhausted'
>;
export const subscriptionStalenessTargetMs = 15 * 60_000;
export const subscriptionScanBudgetMs = 60_000;
export const subscriptionScanPageLimit = 12;
export type SubscriptionScan = {
  readonly startedAt: string;
  readonly pages: number;
};

const validCount = (n: number) => Number.isSafeInteger(n) && n >= 0;
function observationAges(
  facts: SubscriptionFreshnessFacts,
  scan: SubscriptionScan,
) {
  const at = Date.parse(facts.sampledAt),
    startedAt = Date.parse(scan.startedAt);
  const age = (value: string | null) =>
    value === null ? null : at - Date.parse(value);
  return {
    at,
    startedAt,
    duration: at - startedAt,
    pendingAge: age(facts.oldestRevisionRequestedAt),
    observedAge: age(facts.oldestObservedAt),
  };
}
type Ages = ReturnType<typeof observationAges>;
function invalidFacts(
  facts: SubscriptionFreshnessFacts,
  scan: SubscriptionScan,
  ages: Ages,
) {
  const cohort = facts.pending + facts.claimed + facts.settled;
  return (
    !validCount(ages.at) ||
    [ages.duration, ages.pendingAge, ages.observedAge].some(
      (n) => n !== null && !validCount(n),
    ) ||
    ![
      scan.pages,
      facts.scanned,
      facts.pending,
      facts.claimed,
      facts.settled,
      facts.unconfirmed,
    ].every(validCount) ||
    scan.pages < 1 ||
    cohort > facts.scanned ||
    facts.unconfirmed > cohort
  );
}
function freshnessStatus(
  facts: SubscriptionFreshnessFacts,
  ages: Ages,
  invalid: boolean,
  complete: boolean,
) {
  if (invalid) return 'unavailable';
  if (
    [ages.pendingAge, ages.observedAge].some(
      (n) => n !== null && n > subscriptionStalenessTargetMs,
    )
  )
    return 'stale';
  if (!complete) return 'partial';
  if (facts.pending + facts.claimed + facts.settled === 0) return 'empty';
  if (facts.unconfirmed > 0 || ages.observedAge === null) return 'unconfirmed';
  return 'within_target';
}

/** Freshness describes the bounded observed cohort, never an access decision or worker heartbeat. */
export function subscriptionFreshness(
  facts: SubscriptionFreshnessFacts,
  exhausted: boolean,
  scan: SubscriptionScan,
) {
  const ages = observationAges(facts, scan),
    { at, startedAt, duration, pendingAge, observedAge } = ages;
  const invalid = invalidFacts(facts, scan, ages);
  const complete =
    !invalid &&
    exhausted &&
    duration <= subscriptionScanBudgetMs &&
    scan.pages <= subscriptionScanPageLimit;
  const status = freshnessStatus(facts, ages, invalid, complete);
  return {
    status,
    targetMs: subscriptionStalenessTargetMs,
    complete,
    scanned: facts.scanned,
    pending: facts.pending,
    claimed: facts.claimed,
    settled: facts.settled,
    unconfirmed: facts.unconfirmed,
    scanPages: scan.pages,
    scanBudgetMs: subscriptionScanBudgetMs,
    scanStartedAtMs: invalid ? null : startedAt,
    sampledAtMs: invalid ? null : at,
    scanDurationMs: invalid ? null : duration,
    oldestRevisionRequestAgeMs: invalid ? null : pendingAge,
    oldestObservedAgeMs: invalid ? null : observedAge,
  } as const;
}
export type SubscriptionFreshness = ReturnType<typeof subscriptionFreshness>;
