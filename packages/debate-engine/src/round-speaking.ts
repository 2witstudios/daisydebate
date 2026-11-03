import type {
  RoundParticipantSeat,
  RoundRules,
  RoundSpeakingChange,
  RoundProjection,
} from '@daisy/protocol';
import type { ClockChange } from './round-clock';

/** Open questioning grants speaking permission without transferring the scheduled floor. */
export const hasOpenQuestioning = (rules: RoundRules): boolean =>
  rules.interaction.interruptions.allowed === 'open';

/** Everyone speaks in cross-examination and under open questioning; no one takes the floor. */
const sharesSpeaking = (rules: RoundRules, sequence: number): boolean =>
  hasOpenQuestioning(rules) || rules.segments[sequence]?.type === 'cross_ex';

export const speakingParticipants = (
  rules: RoundRules,
  seats: readonly RoundParticipantSeat[],
  sequence: number,
  holder: string | null,
): readonly string[] => {
  const segment = rules.segments[sequence];
  if (!segment) return [];
  if (sharesSpeaking(rules, sequence))
    return seats
      .filter((p) => p.role === 'affirmative' || p.role === 'negative')
      .map((p) => p.id);
  if (holder !== null)
    return seats.some((p) => p.id === holder && p.role !== 'judge')
      ? [holder]
      : [];
  return seats
    .filter((p) => p.role === segment.side && p.slot === segment.slot)
    .map((p) => p.id);
};

/** Materialize the existing engine's accepted clock/floor transitions, never a second timetable. */
export function speakingChangesOf(input: {
  readonly rules: RoundRules;
  readonly participants: readonly RoundParticipantSeat[];
  readonly changes: readonly ClockChange[];
  readonly segmentIds: ReadonlyMap<number, string>;
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
    segmentId: input.segmentIds.get(sequence)!,
    at: new Date(atMs).toISOString(),
    participantIds: speakingParticipants(
      input.rules,
      input.participants,
      sequence,
      holder,
    ),
  });
  const result: RoundSpeakingChange[] = input.changes.map((change) => {
    switch (change.kind) {
      case 'open':
        return opened(change.row.sequence, change.row.startedAtMs, null);
      case 'resume':
        return opened(change.sequence, change.atMs, change.holder);
      case 'close':
      case 'stop':
        return {
          kind: 'close',
          segmentId: input.segmentIds.get(change.sequence)!,
          at: new Date(change.atMs).toISOString(),
        };
    }
  });
  const floor = input.floorChange;
  if (floor && !sharesSpeaking(input.rules, floor.sequence)) {
    const segmentId = input.segmentIds.get(floor.sequence)!;
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
