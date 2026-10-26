import { createAppError } from '@daisy/errors';
import {
  idSchema,
  roundBallotReadSchema,
  roundJudgeAssignmentsSchema,
  type LaunchedRound,
  type DebateSide,
  type RoundBallotRead,
} from '@daisy/protocol';
import { and, desc, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { sharedAccount, type Caller, type Account } from './room-command-facts';
import { readAuthorizedRound } from './round-read-authority';
import { ballotReadView, ownJudgeSeat } from './round-ballot-view';
import {
  readRoundCoachingFacts,
  type RoundCoachingFacts,
} from './round-feedback';
import { roundViewFor } from './round-view-projection';
import { ballots } from './schema/ballots';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';

const roundBallotRecordSchema = roundBallotReadSchema.omit({ coaching: true });

/**
 * A Round's ballot read before the coaching feature adds the debater's
 * coaching: the read itself, and the reader's side with its coaching facts.
 */
export type RoundBallotRecord = {
  readonly read: Omit<RoundBallotRead, 'coaching'>;
  readonly coaching: {
    readonly side: DebateSide;
    readonly facts: RoundCoachingFacts;
  } | null;
};

/** The frozen transcript a seated participant reads once the Round completes. */
async function seatTranscript(
  tx: Parameters<typeof readLockedFrozenRoundTranscript>[0],
  roundId: string,
  seated: boolean | undefined,
) {
  if (!seated) return null;
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
  }): Promise<RoundBallotRecord> {
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
      return {
        read: roundBallotRecordSchema.parse({
          round: roundViewFor(round, input.caller.actorId),
          ...ballotReadView({
            status: round.status,
            ownSeatId: ownSeat?.id,
            viewerSide,
            aiJudgeSeatIds,
            rows,
            frozen,
          }),
          // DEC-101: the transcript stays private to the Round's seats.
          transcript: await seatTranscript(
            tx,
            input.roundId,
            seat && completed,
          ),
        }),
        // The coaching feature decides the debater's coaching from these facts.
        coaching:
          viewerSide && completed
            ? {
                side: viewerSide,
                facts: await readRoundCoachingFacts(tx, input.roundId),
              }
            : null,
      };
    });
  },
});
