import type { MessagingStore } from '@daisy/db/stores/messaging';
import { roundFloorRetentionMs } from '@daisy/protocol/round-floor';
import {
  retentionAfter,
  type RetentionTarget,
} from '../../../server/retention-target';

export const floorRetentionTargets = (
  database: Pick<
    MessagingStore,
    | 'purgeExpiredRoundFloorReceipts'
    | 'purgeExpiredRoundFloorMessages'
    | 'purgeExpiredRoundFloorReadStates'
  >,
): readonly RetentionTarget[] => [
  /** Floor expiry is measured from Round end. Drain receipts before their referenced messages. */
  retentionAfter('round_floor_receipts', roundFloorRetentionMs, (batch) =>
    database.purgeExpiredRoundFloorReceipts(batch),
  ),
  retentionAfter('round_floor_messages', roundFloorRetentionMs, (batch) =>
    database.purgeExpiredRoundFloorMessages(batch),
  ),
  retentionAfter('round_floor_read_states', roundFloorRetentionMs, (batch) =>
    database.purgeExpiredRoundFloorReadStates(batch),
  ),
];
