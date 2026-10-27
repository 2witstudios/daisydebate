import { appendTranscriptChanged } from './transcript-signal';
import { createAppError } from '@daisy/errors';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { captureObservationSchema, captureSealSchema } from './capture-input';
import {
  captureHistory,
  advanceTranscriptRevision,
  coverageAuthority,
  transcriptRevision,
} from './capture-history';
import {
  captureWriteContext,
  freshCaptureMutation,
  validCaptureIds,
  type CaptureDependencies,
  type CaptureTx,
} from './media-capture-context';
import {
  transcriptObservations,
  transcriptSegments,
} from './schema/transcript-segments';
import { utterances } from './schema/utterances';
import {
  requireObservationWindow,
  sealAction,
  sealState,
} from './capture-rules';

export async function observeCapturedStream(
  tx: CaptureTx,
  input: z.infer<typeof captureObservationSchema>,
  dependencies: CaptureDependencies,
) {
  const context = await captureWriteContext(
    tx,
    input,
    dependencies,
    new Date(input.observedUntil),
  );
  const { segment, stream, now } = context;
  const required = await captureHistory(tx, input, segment);
  const { from, until } = requireObservationWindow(
    input,
    segment,
    now,
    required,
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
  const revision = await advanceTranscriptRevision(tx, input.roundId);
  if (context.created)
    await appendTranscriptChanged(tx, input.roundId, revision);
  return { duplicate: false, revision };
}
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
  const action = sealAction(stream, input.expectedChunkCount, {
    segmentEnded: segment.endedAt !== null,
    required,
  });
  if (action === 'retry')
    return {
      state: stream.state as 'complete' | 'partial',
      revision: await transcriptRevision(tx, input.roundId),
    };
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
  const state = sealState({
    epoch: input.epoch,
    observations,
    chunks,
    storedChunks: stream.chunkCount,
    expectedChunks: input.expectedChunkCount,
    ...(await coverageAuthority(
      tx,
      input,
      required,
      dependencies.coverageTolerance,
    )),
  });
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
  const revision = await advanceTranscriptRevision(tx, input.roundId);
  await appendTranscriptChanged(tx, input.roundId, revision);
  return { state, revision };
}
