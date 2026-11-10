import { isAppError } from '@daisy/errors';
import type { EconomicsSignal } from './economics-alert';
import type { EconomicsCollection } from './economics-collector';

type Collection<K extends EconomicsCollection['kind']> = Extract<
  EconomicsCollection,
  { readonly kind: K }
>;

/**
 * A failure's identity: its month, its stage and its error code, so a
 * different problem in the same stage (a capacity refusal, then a database
 * outage) is a new notice, while the same problem every hour is one.
 */
export function failureNotice(collection: Collection<'failed'>): string {
  const code = isAppError(collection.cause)
    ? collection.cause.code
    : 'INTERNAL';
  return `${collection.month}:${collection.reason}:${code}`;
}

const signalKey = (signal: EconomicsSignal) => `${signal.name}/${signal.plan}`;

/**
 * What this process has raised for the month it is collecting. Each signal is
 * raised once a month, whatever else changes in the report. A failure is
 * raised once until a report settles again, so a regression after recovery is
 * news. A new month starts empty.
 */
export type EconomicsRaised = {
  readonly month: string | null;
  /** Failure notices reported since the month's last settled report. */
  readonly failures: ReadonlySet<string>;
  /** Signals the reporter took this month. */
  readonly signals: ReadonlySet<string>;
  /** Whether a failure to submit signals was reported since signals last went through. */
  readonly signalFailureReported: boolean;
  /** Whether this month's missing feed was logged. */
  readonly feedMissingLogged: boolean;
};

export const nothingRaised: EconomicsRaised = {
  month: null,
  failures: new Set(),
  signals: new Set(),
  signalFailureReported: false,
  feedMissingLogged: false,
};

/** The record for a month: what was raised if it is the same month, otherwise nothing. */
export const raisedIn = (
  raised: EconomicsRaised,
  month: string,
): EconomicsRaised =>
  raised.month === month ? raised : { ...nothingRaised, month };

/** Whether this failure was already reported since the month's last settled report. */
export const isFailureRaised = (
  raised: EconomicsRaised,
  collection: Collection<'failed'>,
) => raisedIn(raised, collection.month).failures.has(failureNotice(collection));

/** Record a reported failure. */
export function recordFailure(
  raised: EconomicsRaised,
  collection: Collection<'failed'>,
): EconomicsRaised {
  const month = raisedIn(raised, collection.month);
  return {
    ...month,
    failures: new Set([...month.failures, failureNotice(collection)]),
  };
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
 * Record the signals the reporter took for a report. A report whose signals
 * all went through settles, and settling re-arms the month's failures.
 */
export function recordSignals(
  raised: EconomicsRaised,
  collection: Collection<'reported'>,
  outcome: {
    readonly taken: readonly EconomicsSignal[];
    readonly settled: boolean;
    readonly signalFailureReported: boolean;
  },
): EconomicsRaised {
  const month = raisedIn(raised, collection.month);
  return {
    ...month,
    failures: outcome.settled ? new Set() : month.failures,
    signals: new Set([...month.signals, ...outcome.taken.map(signalKey)]),
    signalFailureReported: outcome.signalFailureReported,
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
