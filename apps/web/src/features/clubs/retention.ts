import { type MailStore } from '@daisy/db/stores/mail';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** ADR 0148: a lapsed Club seat invitation (an invitee's address) is kept 30 days. */
export const seatInvitationRetentionTarget = (
  database: Pick<MailStore, 'purgeLapsedClubSeatInvitations'>,
): RetentionTarget =>
  retentionAfter(
    'club_seat_invitations',
    30 * DAY_MS,
    (batch) => database.purgeLapsedClubSeatInvitations(batch),
    { maxBatches: 4 },
  );
