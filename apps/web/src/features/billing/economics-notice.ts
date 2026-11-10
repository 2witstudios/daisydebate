import type { EconomicsSignal } from './economics-alert';
import type { EconomicsCollection } from './economics-collector';

/**
 * The identity of what a collection tells an operator about its month. Equal
 * notices are the same news, so a process raises each one once rather than on
 * every hourly tick; a new month or a changed outcome is a new notice.
 */
export function economicsNotice(collection: EconomicsCollection): string {
  if (collection.kind === 'failed')
    return `${collection.month}:failed:${collection.reason}`;
  const signals = collection.signals
    .map((s) => `${s.name}/${s.plan}`)
    .join(',');
  return `${collection.month}:reported:${collection.feed}:${signals}`;
}

type Collection<K extends EconomicsCollection['kind']> = Extract<
  EconomicsCollection,
  { readonly kind: K }
>;

/** A report raised this month: the signals it still owes, and whether failing to submit them was reported. */
export type ReportProgress = {
  readonly owed: readonly EconomicsSignal[];
  readonly signalFailureReported: boolean;
};

/**
 * What this process has raised for the month it is collecting. A report's
 * signals are raised once per month, even after another outcome came between.
 * A failure is raised once until a report settles again, so a regression after
 * recovery is news. A new month starts empty.
 */
export type EconomicsRaised = {
  readonly month: string | null;
  /** Failure notices reported since the month's last settled report. */
  readonly failures: ReadonlySet<string>;
  /** Report notices raised this month. */
  readonly reports: ReadonlyMap<string, ReportProgress>;
};

export const nothingRaised: EconomicsRaised = {
  month: null,
  failures: new Set(),
  reports: new Map(),
};

const inMonth = (raised: EconomicsRaised, month: string) =>
  raised.month === month ? raised : nothingRaised;

/** Whether this failure was already reported since the month's last settled report. */
export const isFailureRaised = (
  raised: EconomicsRaised,
  collection: Collection<'failed'>,
) =>
  inMonth(raised, collection.month).failures.has(economicsNotice(collection));

/** How far this month already raised this report, if at all. */
export const reportProgress = (
  raised: EconomicsRaised,
  collection: Collection<'reported'>,
): ReportProgress | undefined =>
  inMonth(raised, collection.month).reports.get(economicsNotice(collection));

/** Record a reported failure. */
export function recordFailure(
  raised: EconomicsRaised,
  collection: Collection<'failed'>,
): EconomicsRaised {
  const month = inMonth(raised, collection.month);
  return {
    month: collection.month,
    failures: new Set([...month.failures, economicsNotice(collection)]),
    reports: month.reports,
  };
}

/** Record a report's progress; a settled report re-arms the month's failures. */
export function recordReport(
  raised: EconomicsRaised,
  collection: Collection<'reported'>,
  progress: ReportProgress,
): EconomicsRaised {
  const month = inMonth(raised, collection.month);
  return {
    month: collection.month,
    failures: progress.owed.length === 0 ? new Set() : month.failures,
    reports: new Map([
      ...month.reports,
      [economicsNotice(collection), progress],
    ]),
  };
}
