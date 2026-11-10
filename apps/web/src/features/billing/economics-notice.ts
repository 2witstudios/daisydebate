import { isAppError } from '@daisy/errors';
import type { EconomicsSignal } from './economics-alert';
import type { EconomicsCollection } from './economics-collector';

type Collection<K extends EconomicsCollection['kind']> = Extract<
  EconomicsCollection,
  { readonly kind: K }
>;

/**
 * A failed collection's identity: its month, its stage and its error code, so
 * a different kind of problem in the same stage is a new notice, while the
 * same problem every hour is one. Capacity backpressure is never a notice; the
 * shared failure sink bounds it.
 */
export function failureNotice(collection: Collection<'failed'>): string {
  const code = isAppError(collection.cause)
    ? collection.cause.code
    : 'INTERNAL';
  return `${collection.month}:${collection.reason}:${code}`;
}

/** A failure to submit a month's signals: one notice, however often the reporter throws. */
export const signalFailureNotice = (month: string) => `${month}:signal_failed`;

const signalKey = (signal: EconomicsSignal) => `${signal.name}/${signal.plan}`;

/**
 * What this process has raised for the month it is collecting. Each signal is
 * raised once a month, whatever else changes in the report. A failure notice
 * is raised once until a report settles again, so a regression after recovery
 * is news. A new month starts empty.
 */
export type EconomicsRaised = {
  readonly month: string | null;
  /** Failure notices reported since the month's last settled report. */
  readonly failures: ReadonlySet<string>;
  /** Signals the reporter took this month. */
  readonly signals: ReadonlySet<string>;
  /** Whether this month's missing feed was logged. */
  readonly feedMissingLogged: boolean;
};

export const nothingRaised: EconomicsRaised = {
  month: null,
  failures: new Set(),
  signals: new Set(),
  feedMissingLogged: false,
};

/** The record for a month: what was raised if it is the same month, otherwise nothing. */
export const raisedIn = (
  raised: EconomicsRaised,
  month: string,
): EconomicsRaised =>
  raised.month === month ? raised : { ...nothingRaised, month };

/** Whether this failure notice was already reported since the month's last settled report. */
export const isFailureRaised = (
  raised: EconomicsRaised,
  month: string,
  notice: string,
) => raisedIn(raised, month).failures.has(notice);

/** Record a reported failure notice. */
export function recordFailure(
  raised: EconomicsRaised,
  month: string,
  notice: string,
): EconomicsRaised {
  const record = raisedIn(raised, month);
  return { ...record, failures: new Set([...record.failures, notice]) };
}

/** The report's signals this month has not yet raised. */
export const owedSignals = (
  raised: EconomicsRaised,
  collection: Collection<'reported'>,
): readonly EconomicsSignal[] => {
  const { signals } = raisedIn(raised, collection.month);
  return collection.signals.filter((s) => !signals.has(signalKey(s)));
};

/**
 * Record the signals the reporter took for a report. A report whose owed
 * signals all went through settles, and settling re-arms the month's failure
 * notices, a failure to submit signals included.
 */
export function recordSignals(
  raised: EconomicsRaised,
  collection: Collection<'reported'>,
  outcome: {
    readonly taken: readonly EconomicsSignal[];
    readonly settled: boolean;
  },
): EconomicsRaised {
  const month = raisedIn(raised, collection.month);
  return {
    ...month,
    failures: outcome.settled ? new Set() : month.failures,
    signals: new Set([...month.signals, ...outcome.taken.map(signalKey)]),
  };
}

/** Note that this month's missing feed was logged. */
export const recordFeedMissingLogged = (
  raised: EconomicsRaised,
  collection: Collection<'reported'>,
): EconomicsRaised => ({
  ...raisedIn(raised, collection.month),
  feedMissingLogged: true,
});
