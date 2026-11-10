import type { EconomicsSignal } from './economics-alert';
import type { EconomicsCollection } from './economics-collector';

type Collection<K extends EconomicsCollection['kind']> = Extract<
  EconomicsCollection,
  { readonly kind: K }
>;

/** The parts of a collection that decide what an operator is told about its month. */
export type EconomicsOutcome =
  | Pick<Collection<'reported'>, 'kind' | 'month' | 'feed' | 'signals'>
  | Pick<Collection<'failed'>, 'kind' | 'month' | 'reason'>;

/**
 * The identity of what a collection tells an operator about its month. Equal
 * notices are the same news, so a process raises each one once rather than on
 * every hourly tick; a new month or a changed outcome is a new notice.
 */
export function economicsNotice(outcome: EconomicsOutcome): string {
  if (outcome.kind === 'failed')
    return `${outcome.month}:failed:${outcome.reason}`;
  const signals = outcome.signals.map((s) => `${s.name}/${s.plan}`).join(',');
  return `${outcome.month}:reported:${outcome.feed}:${signals}`;
}

/** One notice raised this month: the signals it still owes, and whether a failure to submit them was reported. */
type RaisedNotice = {
  readonly owed: readonly EconomicsSignal[];
  readonly signalFailureReported: boolean;
};

/**
 * What this process has raised for the month it is collecting: every notice
 * seen, so an outcome that returns after another is not news again. A new month
 * starts empty.
 */
export type EconomicsRaised = {
  readonly month: string | null;
  readonly notices: ReadonlyMap<string, RaisedNotice>;
};

export const nothingRaised: EconomicsRaised = {
  month: null,
  notices: new Map(),
};

const raisedNotice = (raised: EconomicsRaised, outcome: EconomicsOutcome) =>
  raised.month === outcome.month
    ? raised.notices.get(economicsNotice(outcome))
    : undefined;

/** Whether this outcome is already settled this month: raised, with nothing still owed. */
export const isSettled = (raised: EconomicsRaised, outcome: EconomicsOutcome) =>
  raisedNotice(raised, outcome)?.owed.length === 0;

/** The signals a reported outcome still owes, given what this month already raised. */
export function owedSignals(
  raised: EconomicsRaised,
  outcome: Extract<EconomicsOutcome, { readonly kind: 'reported' }>,
): readonly EconomicsSignal[] {
  return raisedNotice(raised, outcome)?.owed ?? outcome.signals;
}

/** Whether a failure to submit this outcome's signals was already reported this month. */
export const isSignalFailureReported = (
  raised: EconomicsRaised,
  outcome: EconomicsOutcome,
) => raisedNotice(raised, outcome)?.signalFailureReported === true;

/** Record what was raised for an outcome; a new month forgets the previous one. */
export function recordRaised(
  raised: EconomicsRaised,
  outcome: EconomicsOutcome,
  notice: RaisedNotice,
): EconomicsRaised {
  const notices = new Map(
    raised.month === outcome.month ? raised.notices : undefined,
  );
  notices.set(economicsNotice(outcome), notice);
  return { month: outcome.month, notices };
}
