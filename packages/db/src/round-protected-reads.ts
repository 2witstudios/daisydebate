import { createAppError } from '@daisy/errors';
import {
  idSchema,
  roundTranscriptReadSchema,
  type LaunchedRound,
} from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { type Caller, type Account } from './room-command-facts';
import { readAuthorizedRound } from './round-read-authority';
import { readOrderedRoundUtterances } from './round-utterance-projection';
import { readTranscriptFreeze } from './frozen-transcript';
import { transcriptRevision } from './capture-history';
import { transcriptSegments } from './schema/transcript-segments';
import { roundViewFor } from './round-view-projection';

export const roundProtectedReads = ({
  database,
}: {
  readonly database: BunSQLDatabase;
}) => ({
  async readRoundTranscript(input: {
    readonly roundId: string;
    readonly caller: Caller;
    /** Transcript-specific audience decision on fresh locked facts. */
    readonly authorize: (round: LaunchedRound, account: Account) => boolean;
  }) {
    if (!idSchema.safeParse(input.roundId).success)
      throw createAppError('VALIDATION');
    return database.transaction(async (tx) => {
      const round = await readAuthorizedRound(tx, input);
      const freeze = await readTranscriptFreeze(tx, input.roundId);
      const streams = await tx
        .select({
          segmentId: transcriptSegments.segmentId,
          roundParticipantId: transcriptSegments.roundParticipantId,
          state: transcriptSegments.state,
        })
        .from(transcriptSegments)
        .where(eq(transcriptSegments.roundId, input.roundId));
      return roundTranscriptReadSchema.parse({
        round: roundViewFor(round, input.caller.actorId),
        revision:
          (await transcriptRevision(tx, input.roundId)) + (freeze ? 1 : 0),
        freeze: freeze ? { completeness: freeze.completeness } : null,
        streams,
        utterances: await readOrderedRoundUtterances(
          tx,
          input.roundId,
          'frozen',
        ),
      });
    });
  },
});
