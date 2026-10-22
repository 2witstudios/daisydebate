import { createAppError } from '@daisy/errors';
import { idSchema, type LaunchedRound } from '@daisy/protocol';
import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { sharedAccount, type Caller, type Account } from './room-command-facts';
import { launchedRoundRows } from './room-read-operations';
import { utterances } from './schema/utterances';

export const roundProtectedReads = ({
  database,
}: {
  readonly database: BunSQLDatabase;
}) => ({
  async readRoundSegmentUtterances(input: {
    readonly roundId: string;
    readonly segmentId: string;
    readonly caller: Caller;
    readonly authorize: (round: LaunchedRound, account: Account) => boolean;
  }) {
    if (
      !idSchema.safeParse(input.roundId).success ||
      !idSchema.safeParse(input.segmentId).success
    )
      throw createAppError('VALIDATION');
    return database.transaction(async (tx) => {
      const account = await sharedAccount(tx, input.caller);
      const round = await launchedRoundRows(tx, input.roundId);
      if (
        !input.authorize(round, account) ||
        !round.participants.some((p) => p.actorId === input.caller.actorId) ||
        !round.segments.some((s) => s.id === input.segmentId)
      )
        throw createAppError('NOT_FOUND');
      const lines = await tx
        .select({
          id: utterances.id,
          roundParticipantId: utterances.roundParticipantId,
          sequence: utterances.sequence,
          text: utterances.text,
          complete: utterances.complete,
        })
        .from(utterances)
        .where(
          and(
            eq(utterances.roundId, input.roundId),
            eq(utterances.segmentId, input.segmentId),
          ),
        )
        .orderBy(utterances.sequence);
      return {
        roundId: round.id,
        segmentId: input.segmentId,
        version: round.version,
        utterances: lines,
      };
    });
  },
});
