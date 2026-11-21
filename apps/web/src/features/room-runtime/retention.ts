import type { Database } from '@daisy/db';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** ADR 0059 / DEC-81: accepted Room command receipts dedupe for 24 hours. */
export const roomCommandRetentionTarget = (
  database: Pick<Database, 'purgeExpiredRoomCommands'>,
): RetentionTarget =>
  retentionAfter('room_commands', DAY_MS, (batch) =>
    database.purgeExpiredRoomCommands(batch),
  );
