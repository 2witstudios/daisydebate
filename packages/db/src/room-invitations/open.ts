import { sql, type SQL } from 'drizzle-orm';
import { roomIsOpen } from '../room-open';

/**
 * An invitation still pending at `at`: nobody has answered it and `at` is
 * before its expiry. `invitation` names the `room_invitations` row in the
 * reader's query. Settlement reads these whatever the Room's status, since a
 * Room that is no longer open is what ends them.
 */
export const invitationPending = (at: SQL, invitation: SQL) =>
  sql`(${invitation}.state='pending' and ${invitation}.expires_at > ${at})`;

/**
 * Room invitations' published read: the one rule for an invitation that is
 * open at `at` (ADR 0124). It is pending at `at` and its Room is still open.
 * `invitation` and `room` name the `room_invitations` and `rooms` rows in the
 * reader's query.
 */
export const invitationOpen = (
  at: SQL,
  rows: { readonly invitation: SQL; readonly room: SQL },
) =>
  sql`(${invitationPending(at, rows.invitation)} and ${roomIsOpen(sql`${rows.room}.status`)})`;
