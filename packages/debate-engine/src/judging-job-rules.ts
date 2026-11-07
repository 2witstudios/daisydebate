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

/** Whether a job can still produce or submit a ballot; one rule for the panel and the room. */
export function aiSeatStanding(
  job: JudgingJobFacts,
  _held: HeldBallotFacts,
  nowMs: number,
): AiSeatStanding {
  if (job.status === 'succeeded') return { state: 'succeeded' };
  if (job.status === 'failed') return { state: 'ended' };
  if (job.holdsBallot) return { state: 'holding_ballot' };
  if (job.status === 'blocked') return { state: 'blocked' };
  if (job.status === 'recovering') return { state: 'recovering' };
  if (Date.parse(job.generationDeadlineAt) > nowMs)
    return { state: 'generating', deadlineAt: job.generationDeadlineAt };
  return { state: 'recovering' };
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

/** Finite automatic spending and backoff never erase the result obligation. */
export function planJudgingRecovery(
  input: {
    readonly totalPaidCalls: number;
    readonly windowPaidCalls: number;
    readonly generationDeadlineAt: string;
    readonly definiteRefusal: boolean;
  },
  nowMs: number,
):
  | {
      readonly status: 'blocked';
      readonly reason: 'automatic_spend' | 'provider_refused';
      readonly retryAt: null;
    }
  | {
      readonly status: 'recovering';
      readonly reason: 'attempt_window';
      readonly retryAt: string;
    }
  | {
      readonly status: 'queued';
      readonly reason: null;
      readonly retryAt: string;
    } {
  if (input.totalPaidCalls >= judgingPolicy.maxAutomaticPaidCalls)
    return { status: 'blocked', reason: 'automatic_spend', retryAt: null };
  if (input.definiteRefusal)
    return { status: 'blocked', reason: 'provider_refused', retryAt: null };
  if (
    judgingDispatchEnd(
      {
        paidCalls: input.windowPaidCalls,
        generationDeadlineAt: input.generationDeadlineAt,
      },
      nowMs,
    )
  ) {
    const windows = Math.max(
      0,
      Math.floor(input.totalPaidCalls / judgingPolicy.maxPaidCalls) - 1,
    );
    const delayMs = Math.min(
      300_000,
      judgingPolicy.recoveryMs * 2 ** Math.min(windows, 4),
    );
    return {
      status: 'recovering',
      reason: 'attempt_window',
      retryAt: new Date(nowMs + delayMs).toISOString(),
    };
  }
  return {
    status: 'queued',
    reason: null,
    retryAt: new Date(nowMs + judgingPolicy.retryMs).toISOString(),
  };
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
  recover: planJudgingRecovery,
};
