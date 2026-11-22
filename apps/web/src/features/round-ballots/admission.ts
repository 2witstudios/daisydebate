import { instantMs } from '@daisy/clock';
import { createAppError, createRefusal } from '@daisy/errors';
import { captureWithinLimit } from '@daisy/protocol/capture-judging-limit';
import type { RoundCommandPrincipal } from '@daisy/protocol/round-command';
import type { RoundOutcome } from '@daisy/protocol/round-outcome';

/**
 * An AI judge rules only on what can be judged (DEC-208, ADR 0110): a complete transcript,
 * or one whose stated gap is within the limit. A job is never queued for anything else,
 * and this holds if one ever is, since rating trusts the ballot.
 */
export function requireAgentBallotCapture(
  principal: RoundCommandPrincipal,
  frozen: {
    readonly completeness: string;
    readonly unheardMs: number | null;
    readonly expectedSpeechMs: number;
  },
): void {
  if (
    principal.kind === 'agent' &&
    frozen.completeness !== 'complete' &&
    !captureWithinLimit({
      gapMs: frozen.unheardMs,
      expectedMs: frozen.expectedSpeechMs,
    })
  )
    throw createAppError(
      'INVARIANT',
      'An AI judge cannot rule on an incomplete transcript',
    );
}

/**
 * A new ballot needs an undecided Round still before
 * its persisted ballot deadline by the database clock (DEC-207), and an
 * unused judge seat.
 */
export function requireBallotAdmission(input: {
  readonly round: {
    readonly status: string;
    readonly outcome: RoundOutcome | null;
  };
  readonly submittedJudgeIds: readonly string[];
  readonly judgeParticipantId: string;
  readonly now: string;
  readonly ballotDeadlineAt: Date | null;
}): void {
  if (input.round.status !== 'active' || input.round.outcome !== null)
    throw createRefusal('CONFLICT', 'round-decided');
  if (
    input.ballotDeadlineAt &&
    instantMs(input.now) >= input.ballotDeadlineAt.getTime()
  )
    throw createRefusal('CONFLICT', 'round-decided');
  if (input.submittedJudgeIds.includes(input.judgeParticipantId))
    throw createRefusal('CONFLICT', 'ballot-already-submitted');
}
