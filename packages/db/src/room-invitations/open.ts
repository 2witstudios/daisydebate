import { openRoomStatuses } from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Room invitations' published read: the one rule for an invitation that is
 * open at `at` (ADR 0124). It is pending, `at` is before its expiry, and its
 * Room is still open. `invitation` and `room` name the `room_invitations` and
 * `rooms` rows in the reader's query.
 */
export const invitationOpen = (
  at: SQL,
  rows: { readonly invitation: SQL; readonly room: SQL },
) =>
  sql`(${rows.invitation}.state='pending' and ${rows.invitation}.expires_at > ${at}
    and ${rows.room}.status in (${sql.join(
      openRoomStatuses.map((status) => sql`${status}`),
      sql`,`,
    )}))`;
