import { and, eq } from 'drizzle-orm';
import type { CaptureTx, CaptureStream } from './media-capture-context';
import { transcriptSegments } from './schema/transcript-segments';
const streamUpdate = (tx: CaptureTx) => tx.update(transcriptSegments);

/** Both text appends and sealing mutate the same durable seat/segment stream. */
export const updateCaptureStream = (
  tx: CaptureTx,
  stream: CaptureStream,
  fields: Parameters<ReturnType<typeof streamUpdate>['set']>[0],
) =>
  streamUpdate(tx)
    .set(fields)
    .where(
      and(
        eq(transcriptSegments.segmentId, stream.segmentId),
        eq(transcriptSegments.roundParticipantId, stream.roundParticipantId),
      ),
    );
