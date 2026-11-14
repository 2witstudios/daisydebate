import type { RoundHydration } from '@daisy/db/rounds';
import { finalSpeechKey, type AttendanceWindow } from '@daisy/debate-engine';
import { createAppError, createRefusal } from '@daisy/errors';
import {
  isDebatingSeat,
  otherSide,
  sameSeat,
  sideOfSeat,
  type RoundRules,
  type SideKey,
} from '@daisy/protocol';

/**
 * The side an absent speaker's forfeit hands the win to: the other side of a
 * two-sided Round decided by a winner, else none (TAB-6.2).
 */
const forfeitsToOf = (rules: RoundRules, side: SideKey | null) =>
  side !== null && rules.outcome.kind === 'winner' && rules.sides.length === 2
    ? otherSide(rules.sides, side)
    : null;
/** Actual immutable opening + frozen scheduled slot; current floor/media eligibility grant no attendance authority. */
export function attendanceWindowFor(
  round: Pick<RoundHydration, 'rules' | 'segments' | 'participants'>,
  segmentId: string,
  eligibleParticipantIds: readonly string[],
): AttendanceWindow {
  const actual = round.segments.find((segment) => segment.id === segmentId);
  if (!actual || actual.type !== 'speech')
    throw createRefusal('CONFLICT', 'attendance-segment');
  const scheduled = round.rules.segments.find(
    (segment) => segment.key === actual.rulesSegmentKey,
  );
  if (
    !scheduled ||
    scheduled.type !== 'speech' ||
    scheduled.speak.rights !== 'one'
  )
    throw createAppError('INVARIANT', 'Speech must reference frozen rules');
  const scheduledSeat = scheduled.speak.seat;
  const speaker = round.participants.find((seat) =>
    sameSeat(seat.seat, scheduledSeat),
  );
  if (!speaker)
    throw createAppError(
      'INVARIANT',
      'Actual speech requires its scheduled speaker slot',
    );
  return {
    segmentId,
    openedAtMs: Date.parse(actual.startedAt),
    speakerId: speaker.id,
    speakerSide: sideOfSeat(scheduledSeat),
    forfeitsTo: forfeitsToOf(round.rules, sideOfSeat(scheduledSeat)),
    eligibleSeats: round.participants
      .filter(
        (seat) =>
          isDebatingSeat(seat.seat) && eligibleParticipantIds.includes(seat.id),
      )
      .map((seat) => ({ id: seat.id, side: sideOfSeat(seat.seat) })),
    lastSpeech: finalSpeechKey(round.rules.segments) === scheduled.key,
  };
}
