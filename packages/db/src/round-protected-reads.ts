import { createAppError } from '@daisy/errors';
import {
  idSchema,
  roundTranscriptReadSchema,
  TRANSCRIPT_CONTRACT_VERSION,
  type LaunchedRound,
} from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { type Caller, type Account } from './room-command-facts';
import { readAuthorizedRound } from './round-read-authority';
import { readOrderedRoundUtterances } from './round-utterance-projection';
import { readTranscriptFreeze } from './frozen-transcript';
import { transcriptRevision } from './capture-history';
import { closedStreamGaps, streamKey } from './capture-gaps';
import type { CaptureRule } from './capture-decisions-port';
import { transcriptSegments } from './schema/transcript-segments';
import { roundViewFor } from './round-view-projection';

type Reader = Pick<BunSQLDatabase, 'select'>;

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
    readonly captureRule: CaptureRule;
  }) {
    if (!idSchema.safeParse(input.roundId).success)
      throw createAppError('VALIDATION');
    return database.transaction(async (tx) => {
      const round = await readAuthorizedRound(tx, input);
      return roundTranscriptReadSchema.parse({
        contractVersion: TRANSCRIPT_CONTRACT_VERSION,
        round: roundViewFor(round, input.caller.actorId),
        ...(await readTranscriptSnapshot(tx, input.roundId, input.captureRule)),
      });
    });
  },
});

/**
 * The authorized transcript rows, counter first: under READ COMMITTED a write
 * committed during these reads can only make the rows newer than the
 * revision, so its doorbell still refetches (never a stale "Capturing").
 */
export async function readTranscriptSnapshot(
  tx: Reader,
  roundId: string,
  captureRule: CaptureRule,
) {
  const counter = await transcriptRevision(tx, roundId);
  const freeze = await readTranscriptFreeze(tx, roundId);
  const streams = await tx
    .select({
      segmentId: transcriptSegments.segmentId,
      roundParticipantId: transcriptSegments.roundParticipantId,
      state: transcriptSegments.state,
      partialReasons: transcriptSegments.partialReasons,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.roundId, roundId));
  const gaps = await closedStreamGaps(
    tx,
    roundId,
    streams.filter(
      (stream) =>
        stream.state === 'partial' || (freeze && stream.state === 'open'),
    ),
    captureRule,
  );
  return {
    revision: counter + (freeze ? 1 : 0),
    freeze: freeze ? { completeness: freeze.completeness } : null,
    streams: streams.map((stream) => ({
      ...stream,
      gaps: gaps.get(streamKey(stream)) ?? [],
    })),
    utterances: await readOrderedRoundUtterances(tx, roundId, 'frozen'),
  };
}
