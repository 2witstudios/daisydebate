import { isAppError } from '@daisy/errors';
import type { EconomicsSignal } from './economics-alert';
import { typedCodeOr, type EconomicsCollection } from './economics-collector';

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
  const { cause, code } = collection;
  return `${collection.month}:${collection.reason}:${code}:${problemOf(cause)}`;
}

/** A system error's own closed code: an errno such as ECONNREFUSED, or a SQLSTATE. */
const systemCode = (error: Error) =>
  'code' in error && typeof error.code === 'string' ? error.code : '';

/**
 * What distinguishes one problem from another without reading free text (ADR
 * 0102): a typed refusal's closed reason, plus the system code of an untyped
 * error it wraps (so EMFILE and EIO differ), or an untyped error's class and
 * system code. A typed error with no reason is one problem per code.
 */
export function problemOf(cause: unknown): string {
  if (isAppError(cause)) {
    const inner = cause.cause;
    const system =
      inner instanceof Error && !isAppError(inner) ? systemCode(inner) : '';
    return `${cause.reason ?? ''}/${system}`;
  }
  if (!(cause instanceof Error)) return '';
  return `${cause.name}/${systemCode(cause)}`;
}

/** A failure outside any collection: its code and problem, one notice until a collection completes. */
export const collectFailureNotice = (error: unknown) =>
  `collect:${typedCodeOr(error, 'INTERNAL')}:${problemOf(error)}`;

/** A failure to submit a month's signals: one notice, however often the reporter throws. */
export const signalFailureNotice = (month: string) => `${month}:signal_failed`;

const signalKey = (signal: EconomicsSignal) => `${signal.name}/${signal.plan}`;

/**
 * What this process has raised for the month it is collecting. Each signal is
 * raised once a month, whatever else changes in the report. A failure notice
 * is raised once until a report settles again, so a regression after recovery
 * is news. A new month starts empty, except failures outside any collection,
 * which are not month-bound and clear when a collection completes.
 */
export type EconomicsRaised = {
  readonly month: string | null;
  /** Failure notices reported since the month's last settled report. */
  readonly failures: ReadonlySet<string>;
  /** Signals the reporter took this month. */
  readonly signals: ReadonlySet<string>;
  /** Whether this month's missing feed was logged. */
  readonly feedMissingLogged: boolean;
  /** Failures outside any collection reported since a collection last completed; not month-bound. */
  readonly collect: ReadonlySet<string>;
};

export const nothingRaised: EconomicsRaised = {
  month: null,
  failures: new Set(),
  signals: new Set(),
  feedMissingLogged: false,
  collect: new Set(),
};

/** The record for a month: what was raised if it is the same month, otherwise a fresh month that keeps only the collect notices. */
export const raisedIn = (
  raised: EconomicsRaised,
  month: string,
): EconomicsRaised =>
  raised.month === month
    ? raised
    : { ...nothingRaised, month, collect: raised.collect };

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
    // A saved report is a recovered collection: its stage failures re-arm. Only a failure to
    // submit the signals stays raised until they go through.
    failures: outcome.settled
      ? new Set()
      : new Set(
          [...month.failures].filter(
            (notice) => notice === signalFailureNotice(collection.month),
          ),
        ),
    signals: new Set([...month.signals, ...outcome.taken.map(signalKey)]),
  };
}

/**
 * Note whether this month's missing feed is logged: set once the line is
 * written, cleared when a feed is supplied, so a feed that later disappears is
 * logged again.
 */
export const recordFeedMissingLogged = (
  raised: EconomicsRaised,
  month: string,
  logged: boolean,
): EconomicsRaised => ({
  ...raisedIn(raised, month),
  feedMissingLogged: logged,
});

/** Whether this failure outside any collection was already reported since one completed. */
export const isCollectRaised = (raised: EconomicsRaised, notice: string) =>
  raised.collect.has(notice);

/** Record a reported failure outside any collection. */
export const recordCollect = (
  raised: EconomicsRaised,
  notice: string,
): EconomicsRaised => ({
  ...raised,
  collect: new Set([...raised.collect, notice]),
});

/** A collection completed, so failures outside one are news again. */
export const collectCompleted = (raised: EconomicsRaised): EconomicsRaised =>
  raised.collect.size === 0 ? raised : { ...raised, collect: new Set() };
