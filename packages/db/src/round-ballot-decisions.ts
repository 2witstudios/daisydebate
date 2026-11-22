import { createAppError, createRefusal } from '@daisy/errors';
import {
  ballotSchemaFor,
  ballotSubjectsFor,
} from '@daisy/protocol/ballot-schema';
import type { Ballot } from '@daisy/protocol/ballot-schema';
import type {
  RoundBallotEnvelope,
  RoundBallotReceipt,
} from '@daisy/protocol/round-ballot';
import type { RoundCommandPrincipal } from '@daisy/protocol/round-command';
import type { RoundJudging } from '@daisy/protocol/ballot-definition';
import type { RoundParticipantSeat } from '@daisy/protocol/runtime';

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

/** Optimistic binding is checked after replay and before new-ballot policy. */
export function requireBallotVersion(
  version: number,
  expectedVersion: number,
): void {
  if (version !== expectedVersion)
    throw createRefusal('CONFLICT', 'stale-version');
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
