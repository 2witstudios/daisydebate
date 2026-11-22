import { instantMs } from '@daisy/clock';
import { createAppError, createRefusal } from '@daisy/errors';
import {
  ballotSchemaFor,
  ballotSubjectsFor,
} from '@daisy/protocol/ballot-schema';
import { captureWithinLimit } from '@daisy/protocol/capture-judging-limit';
import type { Ballot } from '@daisy/protocol/ballot-schema';
import type {
  RoundBallotEnvelope,
  RoundBallotReceipt,
} from '@daisy/protocol/round-ballot';
import type { RoundCommandPrincipal } from '@daisy/protocol/round-command';
import type { RoundJudging } from '@daisy/protocol/ballot-definition';
import type { RoundOutcome } from '@daisy/protocol/round-outcome';
import type { RoundParticipantSeat } from '@daisy/protocol/runtime';

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

/** A bot ballot needs a lease check and the live judging run for this exact job. */
export function requireJudgingRun(
  input: {
    readonly roundId: string;
    readonly principal: RoundCommandPrincipal;
    readonly envelope: Pick<
      RoundBallotEnvelope,
      'judgeParticipantId' | 'freezeRevision'
    >;
    readonly leased: boolean;
  },
  run: {
    readonly runKind: string | null;
    readonly runConfiguration: Record<string, unknown> | null;
  },
): void {
  if (input.principal.kind !== 'agent') return;
  const config = run.runConfiguration;
  if (
    !input.leased ||
    run.runKind !== 'judging' ||
    config?.roundId !== input.roundId ||
    config.judgeParticipantId !== input.envelope.judgeParticipantId ||
    config.freezeRevision !== input.envelope.freezeRevision ||
    !Number.isSafeInteger(config.jobEpoch) ||
    Number(config.jobEpoch) <= 0
  )
    throw createAppError('AUTHORIZATION');
}

/** Ballots judge only the exact frozen revision they name. */
export function requireFrozenRevision<
  Frozen extends { readonly revision: number },
>(frozen: Frozen | null | undefined, freezeRevision: number): Frozen {
  if (!frozen || frozen.revision !== freezeRevision)
    throw createRefusal('CONFLICT', 'freeze-not-ready');
  return frozen;
}

/**
 * A new ballot needs the expected version, an undecided Round still before
 * its persisted ballot deadline by the database clock (DEC-207), and an
 * unused judge seat.
 */
export function requireBallotAdmission(input: {
  readonly version: number;
  readonly expectedVersion: number;
  readonly round: {
    readonly status: string;
    readonly outcome: RoundOutcome | null;
  };
  readonly submittedJudgeIds: readonly string[];
  readonly judgeParticipantId: string;
  readonly now: string;
  readonly ballotDeadlineAt: Date | null;
}): void {
  if (input.version !== input.expectedVersion)
    throw createRefusal('CONFLICT', 'stale-version');
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

/** The version only advances when the engine projection changed the Round. */
export const ballotReceipt = (input: {
  readonly commandId: string;
  readonly roundId: string;
  readonly ballotId: string;
  readonly judgeParticipantId: string;
  readonly freezeRevision: number;
  readonly version: number;
  readonly changed: boolean;
  readonly outcome: RoundBallotReceipt['outcome'] | undefined;
}): RoundBallotReceipt => ({
  commandId: input.commandId,
  roundId: input.roundId,
  ballotId: input.ballotId,
  judgeParticipantId: input.judgeParticipantId,
  freezeRevision: input.freezeRevision,
  resultingVersion: input.version + (input.changed ? 1 : 0),
  outcome: input.outcome ?? null,
});

/**
 * The ballot as the Round's own schema reads it (TAB-6.11): the definition
 * frozen on the Round over its sides, competitors and segments. A ballot
 * that does not fit it is refused, human or AI alike; a Round that is judged
 * by nobody takes no ballot.
 */
export function requireRoundBallot(
  round: {
    readonly judging: RoundJudging;
    readonly rules: Parameters<typeof ballotSubjectsFor>[0];
    readonly participants: readonly Pick<RoundParticipantSeat, 'id' | 'seat'>[];
  },
  ballot: unknown,
): Ballot {
  if (!round.judging)
    throw createAppError(
      'INVARIANT',
      'A Round judged by nobody takes no ballot',
    );
  const parsed = ballotSchemaFor(
    round.judging.ballot,
    ballotSubjectsFor(round.rules, round.participants),
  ).safeParse(ballot);
  if (!parsed.success) throw createAppError('VALIDATION');
  return parsed.data as Ballot;
}

/** What a ballot decided, in the columns a ballot row stores it in. */
export const ballotDecisionColumns = (ballot: Ballot) => {
  if (ballot.ranking !== undefined)
    return {
      decision: 'ranking' as const,
      winner: null,
      ranking: ballot.ranking.map((place) => [...place]),
    };
  const decision = ballot.decision ?? 'win';
  if ((decision === 'win') !== (ballot.winner != null))
    throw createAppError('VALIDATION');
  return { decision, winner: ballot.winner ?? null, ranking: null };
};
