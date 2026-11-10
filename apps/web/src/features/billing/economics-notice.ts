import type { EconomicsSignal } from './economics-alert';
import type {
  EconomicsCollection,
  EconomicsCollectionFailure,
} from './economics-collector';

/** Every reason a month is raised under: a failed stage, or a missing feed. */
export type EconomicsReason = EconomicsCollectionFailure | 'feed_missing';

/**
 * What this process raised for the month it collects. A reason is raised once
 * per streak: it stays raised until a report settles (is saved and its signals
 * submitted), so a regression after recovery is raised again. `feed_missing`
 * ends only when a feed is supplied. Each signal is raised once a month. A new
 * month starts empty.
 */
export type EconomicsRaised = {
  readonly month: string | null;
  readonly reasons: ReadonlySet<EconomicsReason>;
  readonly signals: ReadonlySet<string>;
};

export const nothingRaised: EconomicsRaised = {
  month: null,
  reasons: new Set(),
  signals: new Set(),
};

const raisedIn = (raised: EconomicsRaised, month: string): EconomicsRaised =>
  raised.month === month
    ? raised
    : { month, reasons: new Set(), signals: new Set() };

const signalKey = (signal: EconomicsSignal) => `${signal.name}/${signal.plan}`;

/** Whether this reason was already raised in the month's current streak. */
export const isRaised = (
  raised: EconomicsRaised,
  month: string,
  reason: EconomicsReason,
) => raisedIn(raised, month).reasons.has(reason);

/** Record a raised reason. */
export function recordRaised(
  raised: EconomicsRaised,
  month: string,
  reason: EconomicsReason,
): EconomicsRaised {
  const record = raisedIn(raised, month);
  return { ...record, reasons: new Set([...record.reasons, reason]) };
}

/** The report's signals this month has not yet raised. */
export function owedSignals(
  raised: EconomicsRaised,
  collection: Extract<EconomicsCollection, { readonly kind: 'reported' }>,
): readonly EconomicsSignal[] {
  const { signals } = raisedIn(raised, collection.month);
  return collection.signals.filter((s) => !signals.has(signalKey(s)));
}

/**
 * Record a saved report: the signals the reporter took, and whether they all
 * went through. A settled report ends every streak but a still-missing feed's;
 * a supplied feed ends that one.
 */
export function recordReport(
  raised: EconomicsRaised,
  collection: Extract<EconomicsCollection, { readonly kind: 'reported' }>,
  outcome: {
    readonly taken: readonly EconomicsSignal[];
    readonly settled: boolean;
  },
): EconomicsRaised {
  const record = raisedIn(raised, collection.month);
  const reasons = new Set(
    [...record.reasons].filter((reason) =>
      reason === 'feed_missing'
        ? collection.feed === 'missing'
        : !outcome.settled,
    ),
  );
  return {
    ...record,
    reasons,
    signals: new Set([...record.signals, ...outcome.taken.map(signalKey)]),
  };
}
