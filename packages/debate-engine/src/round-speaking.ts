import type {
  RoundParticipantSeat,
  RoundRules,
  RoundSpeakingChange,
  RoundProjection,
} from '@daisy/protocol';
import type { ClockChange } from './round-clock';

/** Speaking eligibility is distinct from command/floor control in free CX. */
export const speakingParticipants = (
  rules: RoundRules,
  seats: readonly RoundParticipantSeat[],
  sequence: number,
  holder: string | null,
): readonly string[] => {
  const segment = rules.segments[sequence];
  if (!segment) return [];
  if (segment.type === 'cross_ex' && rules.interaction.crossExMode === 'free')
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
    readonly holder: string;
  } | null;
}): NonNullable<RoundProjection['speakingChanges']> {
  const result: RoundSpeakingChange[] = input.changes.map((change) =>
    change.kind === 'close'
      ? {
          kind: 'close',
          segmentId: input.segmentIds.get(change.sequence)!,
          at: new Date(change.atMs).toISOString(),
        }
      : {
          kind: 'open',
          segmentId: input.segmentIds.get(change.row.sequence)!,
          at: new Date(change.row.startedAtMs).toISOString(),
          participantIds: speakingParticipants(
            input.rules,
            input.participants,
            change.row.sequence,
            null,
          ),
        },
  );
  const floor = input.floorChange;
  if (
    floor &&
    !(
      input.rules.segments[floor.sequence]?.type === 'cross_ex' &&
      input.rules.interaction.crossExMode === 'free'
    )
  ) {
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
