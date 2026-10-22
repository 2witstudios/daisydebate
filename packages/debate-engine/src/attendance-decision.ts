import { createInvariantError } from '@daisy/errors';
import { adjudicateAttendance, type AttendanceDecision } from './attendance';
import { debateInvariantIds } from './invariant-ids';
export type AttendanceDecisionEvidence = Parameters<
  typeof adjudicateAttendance
>[0] & { readonly segmentType: 'speech' | 'cross_ex' | 'prep' };
/** Refuse a supplied result that disagrees with settled, irreversible attendance evidence. */
export function requireAttendanceDecision(
  input: AttendanceDecisionEvidence,
  decision: AttendanceDecision,
): void {
  if (input.finalized)
    throw createInvariantError(
      debateInvariantIds.attendanceFinalizedIrreversible,
      'Attendance decisions are immutable',
    );
  if (input.segmentType !== 'speech')
    throw createInvariantError(
      debateInvariantIds.speechTurnsOnly,
      'Only actual speeches carry attendance decisions',
    );
  if (input.window.lastSpeech)
    throw createInvariantError(
      debateInvariantIds.lastSpeechNeverForfeits,
      'Last speech never adjudicates attendance',
    );
  const expected = adjudicateAttendance(input);
  if (expected === null)
    throw createInvariantError(
      debateInvariantIds.failurePostponesOnly,
      'Availability evidence is not settled through the attendance buffer',
    );
  if (!sameDecision(expected, decision))
    throw createInvariantError(
      debateInvariantIds.timestampDecides,
      'Decision disagrees with durable receipt timestamps',
    );
}
function sameDecision(
  expected: AttendanceDecision,
  actual: AttendanceDecision,
): boolean {
  if (
    expected.decision !== actual.decision ||
    expected.effectiveDeadlineMs !== actual.effectiveDeadlineMs
  )
    return false;
  if (expected.decision === 'forfeit')
    return actual.decision === 'forfeit' && actual.winner === expected.winner;
  return true;
}
