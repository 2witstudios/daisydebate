import { isDefiniteRefusal, isOpenTimelineRefusal } from '@daisy/media/worker';
import type { CaptureClient } from './capture-history';

/**
 * Seals each stream once. A definite refusal (cutoff, freeze, chunks below the
 * stored count) finishes the stream like a seal does. A seal refused for its
 * still-open timeline, or with an uncertain outcome (an outage that outlasted
 * its retries, a deadline, the network), stays sealable: the next batch
 * retries it, then the shutdown fallback (VIDEO-4.1-r1).
 */
export async function sealCaptureStreams(
  client: CaptureClient,
  epoch: number,
  streams: Iterable<{
    segmentId: string;
    roundParticipantId: string;
    count: number;
  }>,
  signal: AbortSignal,
  finished: (stream: { segmentId: string; roundParticipantId: string }) => void,
) {
  let count = 0;
  for (const stream of streams) {
    try {
      await client.seal(
        {
          epoch,
          segmentId: stream.segmentId,
          roundParticipantId: stream.roundParticipantId,
          expectedChunkCount: stream.count,
        },
        signal,
      );
      finished(stream);
      count++;
    } catch (error) {
      signal.throwIfAborted();
      if (isDefiniteRefusal(error) && !isOpenTimelineRefusal(error))
        finished(stream);
    }
  }
  return count;
}
