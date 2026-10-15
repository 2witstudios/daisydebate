import type { RoundView } from '@daisy/protocol';
import {
  launched,
  round,
} from '../../features/room-runtime/operations.test-support';

/** A practice round, an affirmative human against a bot, with a human judge. */
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
export const view: RoundView = {
  ...round,
  participants: [
    { ...aff, label: 'Sam Reyes' },
    neg,
    { role: 'judge', kind: 'human', slot: 0, anonymous: true },
  ],
};
export const rules = view.rules.segments;
export const origin = Date.parse('2026-10-12T18:00:00.000Z');
export const at = (ms: number) => new Date(origin + ms).toISOString();
export const countdown = view.rules.countdownMs;

/** Milliseconds from the start to segment `sequence`, after the countdown. */
export const startOf = (sequence: number) =>
  countdown +
  rules.slice(0, sequence).reduce((sum, s) => sum + s.durationMs, 0);

/** The first `count` segments back to back; the last stays open unless `closed`. */
export function ran(count: number, closed = false): RoundView {
  const segments = rules.slice(0, count).map((segment, sequence) => ({
    id: `${'s'.repeat(23)}${sequence}`,
    sequence,
    type: segment.type,
    rulesSegmentKey: segment.key,
    startedAt: at(startOf(sequence)),
    endedAt:
      sequence === count - 1 && !closed ? null : at(startOf(sequence + 1)),
    durationMs: segment.durationMs,
  }));
  return { ...view, status: 'active', startedAt: at(0), segments };
}
