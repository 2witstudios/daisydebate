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

/**
 * One notice raised this month: the signals a report still owes, and whether
 * its failure (a failed collection, or a failure to submit the signals) was
 * reported.
 */
export type RaisedNotice = {
  readonly kind: EconomicsCollection['kind'];
  readonly owed: readonly EconomicsSignal[];
  readonly failureReported: boolean;
};

/**
 * What this process has raised for the month it is collecting. A report's
 * signals are raised once per month, even after another outcome came between.
 * A failure is raised once until a report settles again, so a regression after
 * recovery is news. A new month starts empty.
 */
export type EconomicsRaised = {
  readonly month: string | null;
  readonly notices: ReadonlyMap<string, RaisedNotice>;
};

export const nothingRaised: EconomicsRaised = {
  month: null,
  notices: new Map(),
};

/** What this month already raised for this collection's outcome, if anything. */
export const raisedFor = (
  raised: EconomicsRaised,
  collection: EconomicsCollection,
): RaisedNotice | undefined =>
  raised.month === collection.month
    ? raised.notices.get(economicsNotice(collection))
    : undefined;

/** Record what was raised for a collection; a settled report re-arms the month's failures. */
export function recordRaised(
  raised: EconomicsRaised,
  collection: EconomicsCollection,
  progress: Omit<RaisedNotice, 'kind'>,
): EconomicsRaised {
  const settledReport =
    collection.kind === 'reported' && progress.owed.length === 0;
  const kept = [
    ...(raised.month === collection.month ? raised.notices : []),
  ].filter(([, notice]) => !(settledReport && notice.kind === 'failed'));
  const notices = new Map(kept);
  notices.set(economicsNotice(collection), {
    kind: collection.kind,
    ...progress,
  });
  return { month: collection.month, notices };
}
