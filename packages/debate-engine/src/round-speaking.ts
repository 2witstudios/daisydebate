import {
  isDebatingSeat,
  isJudgeSeat,
  sameSeat,
  speakingSeatsOf,
  type RoundParticipantSeat,
  type RoundRules,
  type RoundSpeakingChange,
  type RoundProjection,
} from '@daisy/protocol';
import type { ClockChange } from './round-clock-transition';

/** Open questioning grants speaking permission without transferring the scheduled floor. */
export const hasOpenQuestioning = (rules: RoundRules): boolean =>
  rules.interaction.interruptions.allowed === 'open';

/**
 * Several seats speak in a segment whose speak rights name several (cross-
 * examination, an open floor) and under open questioning; no one takes the
 * floor.
 */
const sharesSpeaking = (rules: RoundRules, sequence: number): boolean =>
  hasOpenQuestioning(rules) ||
  (rules.segments[sequence] !== undefined &&
    rules.segments[sequence].speak.rights !== 'one');

/**
 * Who speaks now: under open questioning every debating seat; in a segment
 * several seats speak in, the seats its speak rights grant; otherwise the
 * floor holder, or the segment's one speaker. Never a judge.
 */
export const speakingParticipants = (
  rules: RoundRules,
  seats: readonly RoundParticipantSeat[],
  sequence: number,
  holder: string | null,
): readonly string[] => {
  const segment = rules.segments[sequence];
  if (!segment) return [];
  const { speak } = segment;
  if (hasOpenQuestioning(rules) && speak.rights === 'one')
    return seats.filter((p) => isDebatingSeat(p.seat)).map((p) => p.id);
  if (speak.rights !== 'one') {
    const granted = speakingSeatsOf(rules, speak);
    return seats
      .filter(
        (p) =>
          !isJudgeSeat(p.seat) &&
          granted.some((seat) => sameSeat(seat, p.seat)),
      )
      .map((p) => p.id);
  }
  if (holder !== null)
    return seats.some((p) => p.id === holder && !isJudgeSeat(p.seat))
      ? [holder]
      : [];
  return seats.filter((p) => sameSeat(p.seat, speak.seat)).map((p) => p.id);
};

/** Materialize the existing engine's accepted clock/floor transitions, never a second timetable. */
export function speakingChangesOf(input: {
  readonly rules: RoundRules;
  readonly participants: readonly RoundParticipantSeat[];
  readonly changes: readonly ClockChange[];
  /** The id of a segment the clock has opened. */
  readonly segmentIdOf: (sequence: number) => string;
  readonly floorChange: {
    readonly sequence: number;
    readonly at: string;
    readonly holder: string | null;
  } | null;
}): NonNullable<RoundProjection['speakingChanges']> {
  const opened = (
    sequence: number,
    atMs: number,
    holder: string | null,
  ): RoundSpeakingChange => ({
    kind: 'open',
    segmentId: input.segmentIdOf(sequence),
    at: new Date(atMs).toISOString(),
    participantIds: speakingParticipants(
      input.rules,
      input.participants,
      sequence,
      holder,
    ),
  });
  const result: RoundSpeakingChange[] = input.changes.flatMap(
    (change): RoundSpeakingChange[] => {
      switch (change.kind) {
        case 'open':
          return [opened(change.row.sequence, change.row.startedAtMs, null)];
        case 'resume':
          return [opened(change.sequence, change.atMs, change.holder)];
        case 'close':
        case 'stop':
          return [
            {
              kind: 'close',
              segmentId: input.segmentIdOf(change.sequence),
              at: new Date(change.atMs).toISOString(),
            },
          ];
        case 'incident':
          return [];
      }
    },
  );
  const floor = input.floorChange;
  if (floor && !sharesSpeaking(input.rules, floor.sequence)) {
    const segmentId = input.segmentIdOf(floor.sequence);
    result.push(
      { kind: 'close', segmentId, at: floor.at },
      {
        kind: 'open',
        segmentId,
        at: floor.at,
        participantIds: speakingParticipants(
          input.rules,
          input.participants,
          floor.sequence,
          floor.holder,
        ),
      },
    );
  }
  return result;
}
