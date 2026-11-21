import { instantMs } from '@daisy/clock';
import {
  type CompetitionType,
  type RecordingEligibility,
} from '@daisy/protocol';

/**
 * Whether a Round is captured. Ranked always is, as the deal for competing. Any
 * other Round records only when its host opted in and holds the entitlement, or
 * no Recording exists at all.
 */
export const captureEligibility = (input: {
  readonly competitionType: CompetitionType;
  readonly youthRound: boolean;
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
    return input.youthRound
      ? { kind: 'ranked', youth: true }
      : { kind: 'ranked' };
  const admitted = input.tournamentAdmission;
  if (
    admitted &&
    admitted.roundId === input.roundId &&
    input.now &&
    instantMs(input.now) < instantMs(admitted.deadlineAt)
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
