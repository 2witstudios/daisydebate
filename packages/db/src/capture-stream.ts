import { createAppError } from '@daisy/errors';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { captureObservationSchema, captureSealSchema } from './capture-input';
import {
  captureHistory,
  advanceTranscriptRevision,
  transcriptRevision,
} from './capture-history';
import {
  captureWriteContext,
  freshCaptureMutation,
  validCaptureIds,
  type CaptureDependencies,
  type CaptureTx,
} from './media-capture-context';
import { hasCompleteCaptureCoverage } from './capture-coverage';
import {
  transcriptObservations,
  transcriptSegments,
} from './schema/transcript-segments';
import { utterances } from './schema/utterances';

export async function observeCapturedStream(
  tx: CaptureTx,
  input: z.infer<typeof captureObservationSchema>,
  dependencies: CaptureDependencies,
) {
  const context = await captureWriteContext(tx, input, dependencies);
  const { segment, stream, now } = context;
  const required = await captureHistory(tx, input, segment);
  const from = Date.parse(input.observedFrom),
    until = Date.parse(input.observedUntil);
  if (
    from >= until ||
    until > now.getTime() ||
    until >
      Math.min(
        segment.endedAt?.getTime() ?? Infinity,
        segment.startedAt.getTime() + segment.durationMs,
      ) ||
    !required.some(
      (grant) =>
        grant.start <= from && (grant.end === null || until <= grant.end),
    )
  )
    throw createAppError(
      'CONFLICT',
      'Observation is outside capture authority',
    );
  const matches = await tx
    .select({ id: transcriptObservations.id })
    .from(transcriptObservations)
    .where(
      and(
        eq(transcriptObservations.segmentId, input.segmentId),
        eq(transcriptObservations.roundParticipantId, input.roundParticipantId),
        eq(transcriptObservations.trackId, input.trackId),
        eq(transcriptObservations.workerEpoch, input.epoch),
        eq(transcriptObservations.observedFrom, new Date(from)),
        eq(transcriptObservations.observedUntil, new Date(until)),
      ),
    )
    .limit(1);
  if (matches.length > 0)
    return {
      duplicate: true,
      revision: await transcriptRevision(tx, input.roundId),
    };
  if (stream.state !== 'open')
    throw createAppError('CONFLICT', 'Capture stream is sealed');
  const id = dependencies.nextId();
  validCaptureIds(id);
  const mutationNow = await freshCaptureMutation(tx, input.roundId, context);
  if (until > mutationNow.getTime())
    throw createAppError('CONFLICT', 'Capture observation is in the future');
  await tx.insert(transcriptObservations).values({
    id,
    roundId: input.roundId,
    segmentId: input.segmentId,
    roundParticipantId: input.roundParticipantId,
    trackId: input.trackId,
    workerEpoch: input.epoch,
    observedFrom: new Date(from),
    observedUntil: new Date(until),
  });
  return {
    duplicate: false,
    revision: await advanceTranscriptRevision(tx, input.roundId),
  };
}
// A new worker cannot recover in-memory PCM/STT intent from old coverage.
const currentEpochEvidence = (
  observations: readonly { readonly epoch: number }[],
  chunks: { readonly otherEpochChunks: number } | undefined,
  epoch: number,
) =>
  chunks?.otherEpochChunks === 0 &&
  observations.every((row) => row.epoch === epoch);

export async function sealCapturedStream(
  tx: CaptureTx,
  input: z.infer<typeof captureSealSchema>,
  dependencies: CaptureDependencies,
): Promise<{
  readonly state: 'complete' | 'partial';
  readonly revision: number;
}> {
  const context = await captureWriteContext(tx, input, dependencies);
  const { segment, stream } = context;
  const required = await captureHistory(tx, input, segment);
  if (stream.state !== 'open') {
    if (stream.sealedChunkCount !== input.expectedChunkCount)
      throw createAppError('CONFLICT', 'Conflicting capture seal retry');
    return {
      state: stream.state,
      revision: await transcriptRevision(tx, input.roundId),
    };
  }
  // A takeover worker knows only its own epoch's chunks; never seal below the
  // stored count. The stream stays open for finalization instead.
  if (input.expectedChunkCount < stream.chunkCount)
    throw createAppError('CONFLICT', 'Capture seal is below stored chunks');
  if (segment.endedAt === null || required.some((grant) => grant.end === null))
    throw createAppError('CONFLICT', 'Capture timeline is still open');
  const observations = await tx
    .select({
      start: transcriptObservations.observedFrom,
      end: transcriptObservations.observedUntil,
      epoch: transcriptObservations.workerEpoch,
    })
    .from(transcriptObservations)
    .where(
      and(
        eq(transcriptObservations.segmentId, input.segmentId),
        eq(transcriptObservations.roundParticipantId, input.roundParticipantId),
      ),
    );
  const [chunks] = await tx
    .select({
      count: sql<number>`count(*)::integer`,
      otherEpochChunks: sql<number>`count(*) filter (where ${utterances.captureWorkerEpoch} is distinct from ${input.epoch}::integer)::integer`,
    })
    .from(utterances)
    .where(
      and(
        eq(utterances.segmentId, input.segmentId),
        eq(utterances.roundParticipantId, input.roundParticipantId),
        isNotNull(utterances.clipKey),
      ),
    );
  const complete =
    currentEpochEvidence(observations, chunks, input.epoch) &&
    stream.chunkCount === chunks?.count &&
    hasCompleteCaptureCoverage({
      required,
      observed: observations.map((row) => ({
        start: row.start.getTime(),
        end: row.end.getTime(),
      })),
      storedChunks: stream.chunkCount,
      expectedChunks: input.expectedChunkCount,
    });
  const state = complete ? 'complete' : 'partial';
  const mutationNow = await freshCaptureMutation(tx, input.roundId, context);
  await tx
    .update(transcriptSegments)
    .set({
      state,
      sealedChunkCount: input.expectedChunkCount,
      sealedAt: mutationNow,
    })
    .where(
      and(
        eq(transcriptSegments.segmentId, input.segmentId),
        eq(transcriptSegments.roundParticipantId, input.roundParticipantId),
      ),
    );
  return {
    state,
    revision: await advanceTranscriptRevision(tx, input.roundId),
  };
}
