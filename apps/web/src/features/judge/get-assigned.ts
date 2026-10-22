import type { RoundJudgeAssignment } from '@daisy/protocol';
export type AssignedDebate = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly ballotHref: string;
  readonly ballotLabel: string;
  readonly followHref: string;
};
/** Only actual own-seat assignments enter this projection; an empty list stays empty. */
export const getAssignedDebates = (
  assignments: readonly RoundJudgeAssignment[],
): readonly AssignedDebate[] =>
  assignments.map((assignment) => ({
    id: assignment.roundId,
    title: assignment.resolution,
    status: assignmentStatus(assignment),
    ballotHref: `/judge/ballot/${assignment.roundId}`,
    ballotLabel: assignment.ballotStatus ? 'View ballot' : 'Open ballot',
    followHref: `/rounds/${assignment.roundId}`,
  }));
function assignmentStatus(a: RoundJudgeAssignment): string {
  if (a.ballotStatus === 'voided')
    return 'Your ballot is voided. A replacement cannot be submitted.';
  if (a.status === 'completed' || a.status === 'abandoned')
    return a.ballotStatus === 'submitted'
      ? 'Your ballot and the Round result are recorded.'
      : 'This Round is already decided. No ballot is due.';
  if (a.ballotStatus === 'submitted')
    return 'Your ballot is recorded. Other votes or attendance settlement are pending.';
  if (a.freezeRevision !== null)
    return 'The recorded transcript is frozen. Your ballot is open.';
  return a.status === 'scheduled'
    ? 'The Round has not started.'
    : 'The Round is in progress. Your ballot opens after its recorded transcript is frozen.';
}
