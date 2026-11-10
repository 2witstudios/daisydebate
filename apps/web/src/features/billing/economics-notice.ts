import type { EconomicsSignal } from './economics-alert';
import type { EconomicsCollectionFailure } from './economics-collector';

/** The parts of a collection that decide what an operator is told about its month. */
export type EconomicsOutcome =
  | {
      readonly kind: 'reported';
      readonly month: string;
      readonly feed: 'supplied' | 'missing';
      readonly signals: readonly EconomicsSignal[];
    }
  | {
      readonly kind: 'failed';
      readonly month: string;
      readonly reason: EconomicsCollectionFailure;
    };

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
