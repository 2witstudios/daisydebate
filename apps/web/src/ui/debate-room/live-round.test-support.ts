import type {
  RoundLifecycleColumns,
  RoundOutcome,
  RoundView,
} from '@daisy/protocol';
import {
  inLifecycle,
  launched,
  round,
  type OpeningRoundView,
} from '../../features/round-runtime/round.test-support';

/** A casual round, an affirmative human against a bot, with a human judge. */
export const aff = launched.participants[0]!;
export const neg = {
  id: 'n4n6p8r2t4v6x8z1k3b5c7d9',
  actorId: 'o4n6p8r2t4v6x8z1k3b5c7d9',
  kind: 'bot',
  label: 'Practice bot',
  role: 'negative',
  slot: 0,
} as const;
export const judge = {
  id: 'j4n6p8r2t4v6x8z1k3b5c7d9',
  actorId: 'k4n6p8r2t4v6x8z1k3b5c7d9',
  kind: 'human',
  label: 'Riley Judge',
  role: 'judge',
  slot: 0,
} as const;
/** What a debater receives: the human judge's seat is anonymous at the source. */
export const view: OpeningRoundView = {
  ...round,
  participants: [
    { ...aff, label: 'Sam Reyes' },
    neg,
    { role: 'judge', kind: 'human', slot: 0, anonymous: true },
  ],
};
/** A Round view once it has started and before it ends. */
type ActiveRoundView = Extract<RoundView, { readonly status: 'active' }>;
export const rules = view.rules.segments;
export const origin = Date.parse('2026-10-12T18:00:00.000Z');
export const at = (ms: number) => new Date(origin + ms).toISOString();
export const countdown = view.rules.countdownMs;

/** Milliseconds from the start to segment `sequence`, after the countdown. */
export const startOf = (sequence: number) =>
  countdown +
  rules.slice(0, sequence).reduce((sum, s) => sum + s.durationMs, 0);

/** The first `count` segments back to back; the last stays open unless `closed`. */
export function ran(count: number, closed = false): ActiveRoundView {
  const segments = rules.slice(0, count).map((segment, sequence) => ({
    id: `${'s'.repeat(23)}${sequence}`,
    sequence,
    type: segment.type,
    rulesSegmentKey: segment.key,
    startedAt: at(startOf(sequence)),
    endedAt:
      sequence === count - 1 && !closed ? null : at(startOf(sequence + 1)),
    durationMs: segment.durationMs,
    returnedMs: 0,
  }));
  return { ...view, status: 'active', startedAt: at(0), segments };
}

/** A Round that started at the origin, running now. */
export const asActive = <V extends RoundLifecycleColumns>(round: V) =>
  inLifecycle(round, {
    status: 'active',
    startedAt: at(0),
    completedAt: null,
    outcome: null,
  });

/** A Round that started and completed at the origin, with `outcome` or none. */
export const asCompleted = <V extends RoundLifecycleColumns>(
  round: V,
  outcome: RoundOutcome | null = null,
) =>
  inLifecycle(round, {
    status: 'completed',
    startedAt: at(0),
    completedAt: at(0),
    outcome,
  });

/** A Round abandoned at the origin, in its opening. */
export const asAbandoned = <V extends RoundLifecycleColumns>(round: V) =>
  inLifecycle(round, {
    status: 'abandoned',
    startedAt: null,
    completedAt: at(0),
    outcome: null,
  });

/** A zero-judge Round with every speech closed (DEC-191). */
export const unjudgedClosed = (): ActiveRoundView => {
  const closed = ran(rules.length, true);
  return {
    ...closed,
    participants: closed.participants.filter((p) => p.role !== 'judge'),
  };
};
