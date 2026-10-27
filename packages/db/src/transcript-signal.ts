import { buildRoundTopic } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import { appendOutboxEvent } from './outbox';

/** Content-free invalidation committed with the capture write or freeze. */
export async function appendTranscriptChanged(
  tx: BoundedTransactionContext,
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
