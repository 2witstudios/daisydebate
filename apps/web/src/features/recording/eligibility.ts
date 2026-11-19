import {
  isYouthRound,
  type CompetitionType,
  type RatingDivision,
  type RecordingEligibility,
} from '@daisy/protocol';

/**
 * Whether a Round is captured. Ranked always is, as the deal for competing. Any
 * other Round records only when its host opted in and holds the entitlement, or
 * no Recording exists at all.
 */
export const captureEligibility = (input: {
  readonly competitionType: CompetitionType;
  /** A ranked Round's ladder division; null for casual. */
  readonly ladderDivision?: RatingDivision | null;
  /** Its Room's division, null with no Room: a Youth Round's Recording says so. */
  readonly roomDivision?: RatingDivision | null;
  readonly hostActorId: string | null;
  readonly hostOptedIn: boolean;
  readonly hostHoldsRecording: boolean;
  readonly tournamentAdmission?: {
    readonly admissionId: string;
    readonly roundId: string;
    readonly deadlineAt: string;
  } | null;
  readonly roundId?: string;
  readonly now?: string;
}): RecordingEligibility | null => {
  if (input.competitionType === 'ranked')
    return isYouthRound(
      { ladderDivision: input.ladderDivision ?? null },
      { division: input.roomDivision ?? null },
    )
      ? { kind: 'ranked', youth: true }
      : { kind: 'ranked' };
  const admitted = input.tournamentAdmission;
  if (
    admitted &&
    admitted.roundId === input.roundId &&
    input.now &&
    Date.parse(input.now) < Date.parse(admitted.deadlineAt)
  )
    return {
      kind: 'tournament_admission',
      admissionId: admitted.admissionId,
      deadlineAt: admitted.deadlineAt,
    };
  return input.hostActorId !== null &&
    input.hostOptedIn &&
    input.hostHoldsRecording
    ? { kind: 'host_opt_in', hostActorId: input.hostActorId }
    : null;
};
