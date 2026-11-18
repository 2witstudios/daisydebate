import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, timestampColumn } from './columns';
import { organizations } from './organizations';
import { users } from './users';

/**
 * A club member holding one of the club plan's Premium seats (ADR 0148).
 * One seat per account across every club; the seat grants nothing by itself:
 * the `organization_seat` grants are projected from it and the plan.
 */
export const clubSeats = pgTable(
  'club_seats',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedAt: timestampColumn('assigned_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    uniqueIndex('club_seats_user_unique').on(table.userId),
    check('club_seats_assigned_finite', sql`isfinite(${table.assignedAt})`),
  ],
);

/**
 * An emailed offer of a seat that holds a seat while it lives. The address is
 * normalised. The link names the invitation and carries no credential: only a
 * signed-in account with this verified address may accept it. Accepting,
 * declining or cancelling deletes the row; a lapsed row holds nothing and is
 * purged 30 days after it lapses.
 */
export const clubSeatInvitations = pgTable(
  'club_seat_invitations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    invitedByUserId: text('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestampColumn('expires_at').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('club_seat_invitations_organization_idx').on(
      table.organizationId,
      table.expiresAt,
    ),
    index('club_seat_invitations_email_idx').on(table.email),
    check(
      'club_seat_invitations_email_normalized',
      sql`${table.email} = lower(btrim(${table.email})) and length(${table.email}) between 3 and 320`,
    ),
    check(
      'club_seat_invitations_expiry_check',
      sql`isfinite(${table.expiresAt}) and ${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);
