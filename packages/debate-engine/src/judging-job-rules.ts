import {
  judgingPolicy,
  type AiSeatStanding,
  type HeldBallotFacts,
  type JudgingJobFacts,
  type JudgingTerminalReason,
  type RoundEnding,
} from '@daisy/protocol';

/** The budget bounds generation only: a held ballot is never expired by it (DEC-275). */
export const generationBudgetSpent = (
  job: Pick<JudgingJobFacts, 'generationDeadlineAt' | 'holdsBallot'>,
  nowMs: number,
): boolean => !job.holdsBallot && Date.parse(job.generationDeadlineAt) <= nowMs;

/**
 * A held ballot waits out attendance, so its bound runs from whichever is
 * latest: the attendance cutoff, the last attendance decision, or the last
 * uncertain writer resolving, plus a grace for a worker to submit. Only past
 * that does a ballot that can never submit stop holding the Round.
 */
export function heldBallotHoldEndsAtMs(facts: HeldBallotFacts): number {
  const graced = [facts.lastAttendanceDecisionAt, facts.lastWriterResolvedAt]
    .filter((at): at is string => at !== null)
    .map((at) => Date.parse(at) + judgingPolicy.heldBallotGraceMs);
  return Math.max(Date.parse(facts.attendanceCutoffAt), ...graced);
}

/** Whether a job can still produce or submit a ballot; one rule for the panel and the room. */
export function aiSeatStanding(
  job: JudgingJobFacts,
  held: HeldBallotFacts,
  nowMs: number,
): AiSeatStanding {
  if (job.status === 'succeeded') return { state: 'succeeded' };
  if (job.status === 'failed') return { state: 'ended' };
  if (Date.parse(job.generationDeadlineAt) > nowMs)
    return job.holdsBallot
      ? { state: 'holding_ballot' }
      : { state: 'generating', deadlineAt: job.generationDeadlineAt };
  return job.holdsBallot && heldBallotHoldEndsAtMs(held) > nowMs
    ? { state: 'holding_ballot' }
    : { state: 'ended' };
}

/**
 * One paid answer per attempt, a bounded number of attempts (DEC-210's rule for
 * judges): a job that already bought its calls, or whose budget has passed
 * (DEC-275), buys nothing more.
 */
export function judgingDispatchEnd(
  input: {
    readonly paidCalls: number;
    readonly generationDeadlineAt: string;
  },
  nowMs: number,
): JudgingTerminalReason | null {
  if (input.paidCalls >= judgingPolicy.maxPaidCalls)
    return 'attempts_exhausted';
  return Date.parse(input.generationDeadlineAt) <= nowMs
    ? 'generation_deadline'
    : null;
}

/**
 * Why a job still open when its Round ended has ended too. A forfeit cutting
 * off a held ballot is the Round ending; a Round closed without it is the hold
 * running out. Past its budget with no ballot, the budget ended it, not the
 * Round.
 */
export function judgingJobEndReason(
  job: Pick<JudgingJobFacts, 'generationDeadlineAt' | 'holdsBallot'>,
  ending: RoundEnding,
  nowMs: number,
): JudgingTerminalReason {
  if (job.holdsBallot)
    return ending === 'forfeit' ? 'round_ended' : 'ballot_hold_ended';
  return Date.parse(job.generationDeadlineAt) <= nowMs
    ? 'generation_deadline'
    : 'round_ended';
}

/** A job the Round's own end cut off is normal; every other end is reported. */
export const judgingEndIsReported = (reason: JudgingTerminalReason): boolean =>
  reason !== 'round_ended';

/** The rules the judging store applies, injected because the db never imports the engine. */
export const judgingJobRules = {
  budgetSpent: generationBudgetSpent,
  dispatchEnd: judgingDispatchEnd,
};
