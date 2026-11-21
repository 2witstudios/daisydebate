import type { Database } from '@daisy/db';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** ADR 0124: an ended Room invitation is kept 30 days. */
export const roomInvitationRetentionTarget = (
  database: Pick<Database, 'purgeEndedRoomInvitations'>,
): RetentionTarget =>
  retentionAfter('room_invitations', 30 * DAY_MS, (batch) =>
    database.purgeEndedRoomInvitations(batch),
  );
