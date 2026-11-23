import { type RoomStore } from '@daisy/db/stores/rooms';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** ADR 0059: accepted Room command receipts dedupe for 24 hours. */
export const roomCommandRetentionTarget = (
  database: Pick<RoomStore, 'purgeExpiredRoomCommands'>,
): RetentionTarget =>
  retentionAfter('room_commands', DAY_MS, (batch) =>
    database.purgeExpiredRoomCommands(batch),
  );
