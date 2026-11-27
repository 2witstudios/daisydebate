import { isJudgeSeat, sameSeat } from '@daisy/protocol/seats';
import { speakingSeatsOf } from '@daisy/protocol/format-seating';
import {
  type RoundParticipantSeat,
  type RoundSpeakingChange,
  type RoundProjection,
} from '@daisy/protocol/runtime';
import { type RoundRules } from '@daisy/protocol/format';
import type { ClockChange } from './round-clock-transition';

/**
 * Who speaks in a segment now. In a segment several seats speak in (cross-
 * examination, an open floor), the seats its speak rights grant; in a speech,
 * its one scheduled seat, joined by the seat giving an accepted point of
 * information. Never a judge, and never a seat that has left (INTX-12).
 */
export const speakingParticipants = (
  rules: RoundRules,
  seats: readonly RoundParticipantSeat[],
  sequence: number,
  poiHolder: string | null,
  absent: readonly string[] = [],
): readonly string[] => {
  const segment = rules.segments[sequence];
  if (!segment) return [];
  const present = seats.filter(
    (p) => !isJudgeSeat(p.seat) && !absent.includes(p.id),
  );
  const { speak } = segment;
  if (speak.rights !== 'one') {
    const granted = speakingSeatsOf(rules, speak);
    return present
      .filter((p) => granted.some((seat) => sameSeat(seat, p.seat)))
      .map((p) => p.id);
  }
  return present
    .filter(
      (p) =>
        sameSeat(p.seat, speak.seat) ||
        (poiHolder !== null && p.id === poiHolder),
    )
    .map((p) => p.id);
};

/** Materialize the engine's accepted clock and speaker changes, never a second timetable. */
export function speakingChangesOf(input: {
  readonly rules: RoundRules;
  readonly participants: readonly RoundParticipantSeat[];
  readonly changes: readonly ClockChange[];
  /** The seats that have left by the end of the step. */
  readonly absent: readonly string[];
  /** The id of a segment the clock has opened. */
  readonly segmentIdOf: (sequence: number) => string;
}): NonNullable<RoundProjection['speakingChanges']> {
  const opened = (
    sequence: number,
    atMs: number,
    poiHolder: string | null,
  ): RoundSpeakingChange => ({
    kind: 'open',
    segmentId: input.segmentIdOf(sequence),
    at: new Date(atMs).toISOString(),
    participantIds: speakingParticipants(
      input.rules,
      input.participants,
      sequence,
      poiHolder,
      input.absent,
    ),
  });
  const closed = (sequence: number, atMs: number): RoundSpeakingChange => ({
    kind: 'close',
    segmentId: input.segmentIdOf(sequence),
    at: new Date(atMs).toISOString(),
  });
  return input.changes.flatMap((change): RoundSpeakingChange[] => {
    switch (change.kind) {
      case 'open':
        return [opened(change.row.sequence, change.row.startedAtMs, null)];
      case 'resume':
        return [opened(change.sequence, change.atMs, null)];
      case 'speakers':
        return [
          closed(change.sequence, change.atMs),
          opened(change.sequence, change.atMs, change.poiHolder),
        ];
      case 'close':
      case 'stop':
        return [closed(change.sequence, change.atMs)];
      case 'incident':
        return [];
    }
  });
}
