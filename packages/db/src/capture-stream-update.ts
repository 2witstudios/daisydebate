import { and, eq } from 'drizzle-orm';
import type { CaptureStream } from './media-capture-context';
import { transcriptSegments } from './schema/transcript-segments';
import type { Tx } from './tx';
const streamUpdate = (tx: Tx) => tx.update(transcriptSegments);

/** Both text appends and sealing mutate the same durable seat/segment stream. */
export const updateCaptureStream = (
  tx: Tx,
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
