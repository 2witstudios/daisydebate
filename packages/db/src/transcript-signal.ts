import { buildRoundTopic } from '@daisy/protocol/topics';
import { appendOutboxEvent } from './outbox';
import type { Tx } from './tx';

/** Content-free invalidation committed with the capture write or freeze. */
export async function appendTranscriptChanged(
  tx: Tx,
  roundId: string,
  entityVersion: number,
) {
  await appendOutboxEvent(tx, {
    topic: buildRoundTopic(roundId),
    kind: 'round.transcript-changed',
    version: 1,
    payload: {
      kind: 'round.transcript-changed',
      ids: [roundId],
      entityVersion,
    },
  });
}
