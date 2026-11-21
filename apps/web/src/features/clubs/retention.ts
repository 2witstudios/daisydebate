import type { Database } from '@daisy/db';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** ADR 0148: a lapsed Club seat invitation (an invitee's address) is kept 30 days. */
export const seatInvitationRetentionTarget = (
  database: Pick<Database, 'purgeLapsedClubSeatInvitations'>,
): RetentionTarget =>
  retentionAfter(
    'club_seat_invitations',
    30 * DAY_MS,
    (batch) => database.purgeLapsedClubSeatInvitations(batch),
    { maxBatches: 4 },
  );
