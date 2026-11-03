import type { CompetitionType, RecordingEligibility } from '@daisy/protocol';

/**
 * Whether a Round is captured. Ranked always is, as the deal for competing. Any
 * other Round records only when its host opted in and holds the entitlement, or
 * no Recording exists at all.
 */
export const captureEligibility = (input: {
  readonly competitionType: CompetitionType;
  readonly hostActorId: string | null;
  readonly hostOptedIn: boolean;
  readonly hostHoldsRecording: boolean;
}): RecordingEligibility | null => {
  if (input.competitionType === 'ranked') return { kind: 'ranked' };
  return input.hostActorId !== null &&
    input.hostOptedIn &&
    input.hostHoldsRecording
    ? { kind: 'host_opt_in', hostActorId: input.hostActorId }
    : null;
};
