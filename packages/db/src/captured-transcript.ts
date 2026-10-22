import { createAppError } from '@daisy/errors';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { captureClipSchema, captureDigest } from './capture-input';
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
import { transcriptSegments } from './schema/transcript-segments';
import { utterances } from './schema/utterances';
import type { roundSegments } from './schema/round-segments';
import type { CaptureInterval } from './capture-coverage';

type Clip = z.infer<typeof captureClipSchema>;
function requireCapturedWindow(
  input: Clip,
  context: {
    readonly segment: typeof roundSegments.$inferSelect;
    readonly now: Date;
  },
  history: readonly CaptureInterval[],
) {
  const { segment, now } = context;
  const before = Date.parse(input.before),
    after = Date.parse(input.after);
  const nominal = segment.startedAt.getTime() + input.startOffsetMs;
  if (
    before >= after ||
    after > now.getTime() ||
    before > nominal ||
    after < nominal + input.durationMs ||
    !history.some(
      (grant) =>
        grant.start <= before && (grant.end === null || after < grant.end),
    ) ||
    after >=
      Math.min(
        segment.endedAt?.getTime() ?? Infinity,
        segment.startedAt.getTime() + segment.durationMs,
      )
  )
    throw createAppError('CONFLICT', 'Capture window is ineligible');
}
export async function appendCapturedTranscript(
  tx: CaptureTx,
  input: Clip,
  dependencies: CaptureDependencies,
) {
  const context = await captureWriteContext(tx, input, dependencies);
  const { segment, stream, now } = context;
  const history = await captureHistory(tx, input, segment);
  requireCapturedWindow(input, { segment, now }, history);
  const after = Date.parse(input.after);
  const clipKey = captureDigest([
    input.roundId,
    input.segmentId,
    input.roundParticipantId,
    input.trackId,
    input.startOffsetMs,
  ]);
  const bodyDigest = captureDigest([
    clipKey,
    input.durationMs,
    input.text,
    input.before,
    input.after,
  ]);
  const [existing] = await tx
    .select({ digest: utterances.captureBodyDigest })
    .from(utterances)
    .where(eq(utterances.clipKey, clipKey));
  if (existing) {
    if (existing.digest !== bodyDigest)
      throw createAppError('CONFLICT', 'Conflicting captured transcript retry');
    return {
      duplicate: true,
      revision: await transcriptRevision(tx, input.roundId),
    };
  }
  if (stream.state !== 'open')
    throw createAppError('CONFLICT', 'Capture stream is sealed');
  const id = dependencies.nextId();
  validCaptureIds(id);
  const mutationNow = await freshCaptureMutation(tx, input.roundId, context);
  if (after > mutationNow.getTime())
    throw createAppError('CONFLICT', 'Capture window is in the future');
  await tx.insert(utterances).values({
    id,
    roundId: input.roundId,
    segmentId: input.segmentId,
    roundParticipantId: input.roundParticipantId,
    sequence: sql`(select coalesce(max(${utterances.sequence})+1,0) from ${utterances} where ${utterances.segmentId}=${input.segmentId})`,
    text: input.text,
    complete: true,
    clipKey,
    captureTrackId: input.trackId,
    captureStartOffsetMs: input.startOffsetMs,
    captureDurationMs: input.durationMs,
    captureWorkerEpoch: input.epoch,
    captureBodyDigest: bodyDigest,
    createdAt: mutationNow,
  });
  await tx
    .update(transcriptSegments)
    .set({ chunkCount: sql`${transcriptSegments.chunkCount}+1` })
    .where(
      and(
        eq(transcriptSegments.segmentId, input.segmentId),
        eq(transcriptSegments.roundParticipantId, input.roundParticipantId),
      ),
    );
  return {
    duplicate: false,
    revision: await advanceTranscriptRevision(tx, input.roundId),
  };
}
