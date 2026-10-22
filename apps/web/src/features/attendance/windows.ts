import type { RoundHydration } from '@daisy/db';
import type { AttendanceWindow } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
/** Actual immutable opening + frozen scheduled slot; current floor/media eligibility grant no attendance authority. */
export function attendanceWindowFor(
  round: Pick<RoundHydration, 'rules' | 'segments' | 'participants'>,
  segmentId: string,
  eligibleParticipantIds: readonly string[],
): AttendanceWindow {
  const actual = round.segments.find((segment) => segment.id === segmentId);
  if (!actual || actual.type !== 'speech')
    throw createAppError('CONFLICT', 'attendance-segment');
  const scheduled = round.rules.segments.find(
    (segment) => segment.key === actual.rulesSegmentKey,
  );
  if (!scheduled || scheduled.type !== 'speech')
    throw createAppError('INVARIANT', 'Speech must reference frozen rules');
  const speaker = round.participants.find(
    (seat) => seat.role === scheduled.side && seat.slot === scheduled.slot,
  );
  if (!speaker)
    throw createAppError(
      'INVARIANT',
      'Actual speech requires its scheduled speaker slot',
    );
  const last = round.rules.segments
    .filter((segment) => segment.type === 'speech')
    .at(-1);
  return {
    segmentId,
    openedAtMs: Date.parse(actual.startedAt),
    speakerId: speaker.id,
    speakerSide: scheduled.side,
    eligibleSeats: round.participants
      .filter(
        (seat) =>
          seat.role !== 'judge' && eligibleParticipantIds.includes(seat.id),
      )
      .map((seat) => ({
        id: seat.id,
        side: seat.role as 'affirmative' | 'negative',
      })),
    lastSpeech: last?.key === scheduled.key,
  };
}
