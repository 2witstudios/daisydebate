import { type MessagingStore } from '@daisy/db/stores/messaging';
import { roomCommunityRetentionMs } from '@daisy/protocol/room-community';
import {
  retentionAfter,
  type RetentionTarget,
} from '../../../server/retention-target';

export const roomCommunityRetentionTargets = (
  database: Pick<
    MessagingStore,
    | 'purgeExpiredRoomCommunityReceipts'
    | 'purgeExpiredRoomCommunityMessages'
    | 'purgeExpiredRoomCommunityReadStates'
  >,
): readonly RetentionTarget[] => [
  /** Room chat expiry is measured from the Room's end (ADR 0126). Drain receipts before their referenced messages. */
  retentionAfter('room_chat_receipts', roomCommunityRetentionMs, (batch) =>
    database.purgeExpiredRoomCommunityReceipts(batch),
  ),
  retentionAfter('room_chat_messages', roomCommunityRetentionMs, (batch) =>
    database.purgeExpiredRoomCommunityMessages(batch),
  ),
  retentionAfter('room_chat_read_states', roomCommunityRetentionMs, (batch) =>
    database.purgeExpiredRoomCommunityReadStates(batch),
  ),
];
