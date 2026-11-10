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
