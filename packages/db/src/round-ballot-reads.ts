import { createAppError } from '@daisy/errors';
import {
  ballotSchema,
  idSchema,
  roundBallotReadSchema,
  type LaunchedRound,
  type RoundBallotRead,
} from '@daisy/protocol';
import { and, desc, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { sharedAccount, type Caller, type Account } from './room-command-facts';
import { launchedRoundRows } from './room-read-operations';
import { roundViewFor } from './round-view-projection';
import { ballots } from './schema/ballots';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';

type StoredBallot = typeof ballots.$inferSelect;
const ballotBody = (row: StoredBallot) =>
  ballotSchema.parse({
    rubricVersion: row.rubricVersion,
    winner: row.winner,
    scores: row.scores,
    reason: row.reason,
    feedback: row.feedback ?? {},
    ...(row.citations ? { citations: row.citations } : {}),
  });
export const roundBallotReads = ({
  database,
}: {
  readonly database: BunSQLDatabase;
}) => ({
  async listRoundJudgeAssignments(caller: Caller) {
    return database.transaction(async (tx) => {
      const account = await sharedAccount(tx, caller);
      if (!account?.member || account.erased)
        throw createAppError('AUTHORIZATION');
      return tx
        .select({
          roundId: rounds.id,
          resolution: rounds.resolution,
          status: rounds.status,
          outcome: rounds.outcome,
          ballotStatus: ballots.status,
          freezeRevision: roundTranscriptFreezes.revision,
        })
        .from(roundParticipants)
        .innerJoin(rounds, eq(rounds.id, roundParticipants.roundId))
        .leftJoin(ballots, eq(ballots.judgeParticipantId, roundParticipants.id))
        .leftJoin(
          roundTranscriptFreezes,
          eq(roundTranscriptFreezes.roundId, rounds.id),
        )
        .where(
          and(
            eq(roundParticipants.actorId, caller.actorId),
            eq(roundParticipants.role, 'judge'),
          ),
        )
        .orderBy(desc(rounds.createdAt));
    });
  },
  async readRoundBallot(input: {
    readonly roundId: string;
    readonly caller: Caller;
    readonly authorize: (round: LaunchedRound, account: Account) => boolean;
  }): Promise<RoundBallotRead> {
    if (!idSchema.safeParse(input.roundId).success)
      throw createAppError('VALIDATION');
    return database.transaction(async (tx) => {
      const account = await sharedAccount(tx, input.caller);
      const round = await launchedRoundRows(tx, input.roundId);
      if (!input.authorize(round, account)) throw createAppError('NOT_FOUND');
      const ownSeat = round.participants.find(
        (p) =>
          p.actorId === input.caller.actorId &&
          p.role === 'judge' &&
          p.kind === 'human',
      );
      const rows = await tx
        .select()
        .from(ballots)
        .where(eq(ballots.roundId, input.roundId));
      const ownBallot = rows.find((b) => b.judgeParticipantId === ownSeat?.id);
      const frozen = ownSeat
        ? await readLockedFrozenRoundTranscript(tx, input.roundId)
        : null;
      return roundBallotReadSchema.parse({
        round: roundViewFor(round, input.caller.actorId),
        own: ownBallotView(ownSeat?.id, ownBallot),
        freeze: frozen
          ? {
              revision: frozen.revision,
              frontier: frozen.frontier,
              frozenAt: frozen.frozenAt,
              completeness: frozen.completeness,
              utterances: frozen.utterances,
            }
          : null,
        ballots:
          round.status === 'completed'
            ? rows.map((row) => ({
                status: row.status,
                ballot: ballotBody(row),
              }))
            : [],
      });
    });
  },
});

function ownBallotView(
  participantId: string | undefined,
  ballot: StoredBallot | undefined,
) {
  return participantId
    ? {
        participantId,
        status: ballot?.status ?? null,
        ballot: ballot ? ballotBody(ballot) : null,
        freezeRevision: ballot?.freezeRevision ?? null,
      }
    : null;
}
