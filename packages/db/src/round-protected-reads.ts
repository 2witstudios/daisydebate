import { createAppError } from '@daisy/errors';
import {
  idSchema,
  roundTranscriptReadSchema,
  type LaunchedRound,
} from '@daisy/protocol';
import { and, eq } from 'drizzle-orm';
import { CAPTURE_COVERAGE_TOLERANCE } from '@daisy/protocol';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { type Caller, type Account } from './room-command-facts';
import { readAuthorizedRound } from './round-read-authority';
import { readOrderedRoundUtterances } from './round-utterance-projection';
import { readTranscriptFreeze } from './frozen-transcript';
import {
  speakingWindows,
  coverageAuthority,
  transcriptRevision,
} from './capture-history';
import { captureGaps } from './capture-coverage';
import { roundSegments } from './schema/round-segments';
import {
  transcriptObservations,
  transcriptSegments,
} from './schema/transcript-segments';
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
  }) {
    if (!idSchema.safeParse(input.roundId).success)
      throw createAppError('VALIDATION');
    return database.transaction(async (tx) => {
      const round = await readAuthorizedRound(tx, input);
      return roundTranscriptReadSchema.parse({
        round: roundViewFor(round, input.caller.actorId),
        ...(await readTranscriptSnapshot(tx, input.roundId)),
      });
    });
  },
});

/**
 * The authorized transcript rows, counter first: under READ COMMITTED a write
 * committed during these reads can only make the rows newer than the
 * revision, so its doorbell still refetches (never a stale "Capturing").
 */
export async function readTranscriptSnapshot(tx: Reader, roundId: string) {
  const counter = await transcriptRevision(tx, roundId);
  const freeze = await readTranscriptFreeze(tx, roundId);
  const streams = await tx
    .select({
      segmentId: transcriptSegments.segmentId,
      roundParticipantId: transcriptSegments.roundParticipantId,
      state: transcriptSegments.state,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.roundId, roundId));
  const gapped = [];
  for (const stream of streams)
    gapped.push({
      ...stream,
      gaps:
        stream.state === 'partial' || (freeze && stream.state === 'open')
          ? await streamGaps(tx, roundId, stream)
          : [],
    });
  return {
    revision: counter + (freeze ? 1 : 0),
    freeze: freeze ? { completeness: freeze.completeness } : null,
    streams: gapped,
    utterances: await readOrderedRoundUtterances(tx, roundId, 'frozen'),
  };
}

/** A short speech's gaps, as offsets; derived from durable evidence on each read. */
export async function streamGaps(
  tx: Reader,
  roundId: string,
  stream: { readonly segmentId: string; readonly roundParticipantId: string },
) {
  const input = { roundId, ...stream };
  const [segment] = await tx
    .select()
    .from(roundSegments)
    .where(eq(roundSegments.id, stream.segmentId));
  if (!segment) return [];
  const startMs = segment.startedAt.getTime();
  const { authority, tolerance } = await coverageAuthority(
    tx,
    input,
    await speakingWindows(tx, input, segment),
    CAPTURE_COVERAGE_TOLERANCE,
  );
  const observed = await tx
    .select({
      start: transcriptObservations.observedFrom,
      end: transcriptObservations.observedUntil,
    })
    .from(transcriptObservations)
    .where(
      and(
        eq(transcriptObservations.segmentId, stream.segmentId),
        eq(
          transcriptObservations.roundParticipantId,
          stream.roundParticipantId,
        ),
      ),
    );
  return captureGaps({
    authority,
    tolerance,
    observed: observed.map((row) => ({
      start: row.start.getTime(),
      end: row.end.getTime(),
    })),
  }).map((gap) => ({
    fromOffsetMs: Math.max(0, gap.start - startMs),
    untilOffsetMs: Math.max(0, gap.end - startMs),
  }));
}
