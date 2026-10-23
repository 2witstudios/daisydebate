import { createAppError } from '@daisy/errors';
import {
  idSchema,
  roundBallotReadSchema,
  roundJudgeAssignmentsSchema,
  type LaunchedRound,
  type RoundBallotRead,
} from '@daisy/protocol';
import { and, desc, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { sharedAccount, type Caller, type Account } from './room-command-facts';
import { readAuthorizedRound } from './round-read-authority';
import { ballotReadView, ownJudgeSeat } from './round-ballot-view';
import { roundViewFor } from './round-view-projection';
import { ballots } from './schema/ballots';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';

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
      const assignments = await tx
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
      return roundJudgeAssignmentsSchema.parse(assignments);
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
      const round = await readAuthorizedRound(tx, input);
      const ownSeat = ownJudgeSeat(round.participants, input.caller.actorId);
      const rows = await tx
        .select()
        .from(ballots)
        .where(eq(ballots.roundId, input.roundId));
      const frozen = ownSeat
        ? await readLockedFrozenRoundTranscript(tx, input.roundId)
        : null;
      return roundBallotReadSchema.parse({
        round: roundViewFor(round, input.caller.actorId),
        ...ballotReadView({
          status: round.status,
          ownSeatId: ownSeat?.id,
          rows,
          frozen,
        }),
      });
    });
  },
});
