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

/** The frozen transcript an authorized audience reads once the Round completes. */
async function audienceTranscript(
  tx: Parameters<typeof readLockedFrozenRoundTranscript>[0],
  roundId: string,
  allowed: boolean,
) {
  if (!allowed) return null;
  const frozen = await readLockedFrozenRoundTranscript(tx, roundId);
  return frozen
    ? { completeness: frozen.completeness, utterances: frozen.utterances }
    : null;
}

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
    readonly authorizeTranscript: (
      round: LaunchedRound,
      account: Account,
    ) => boolean;
  }): Promise<RoundBallotRead> {
    if (!idSchema.safeParse(input.roundId).success)
      throw createAppError('VALIDATION');
    return database.transaction(async (tx) => {
      let currentAccount: Account = null;
      const round = await readAuthorizedRound(tx, {
        ...input,
        authorize: (candidate, account) => {
          currentAccount = account;
          return input.authorize(candidate, account);
        },
      });
      const ownSeat = ownJudgeSeat(round.participants, input.caller.actorId);
      const rows = await tx
        .select()
        .from(ballots)
        .where(eq(ballots.roundId, input.roundId));
      const frozen = ownSeat
        ? await readLockedFrozenRoundTranscript(tx, input.roundId)
        : null;
      const seat = round.participants.find(
        (p) => p.actorId === input.caller.actorId,
      );
      const completed = round.status === 'completed';
      const viewerSide = seat && seat.role !== 'judge' ? seat.role : undefined;
      const aiJudgeSeatIds = new Set(
        round.participants
          .filter((p) => p.role === 'judge' && p.kind === 'bot')
          .map((p) => p.id),
      );
      return roundBallotReadSchema.parse({
        round: roundViewFor(round, input.caller.actorId),
        ...ballotReadView({
          status: round.status,
          ownSeatId: ownSeat?.id,
          viewerSide,
          aiJudgeSeatIds,
          rows,
          frozen,
        }),
        // The shared transcript audience policy owns this private read.
        transcript: await audienceTranscript(
          tx,
          input.roundId,
          completed && input.authorizeTranscript(round, currentAccount),
        ),
      });
    });
  },
});
