import { sql } from 'drizzle-orm';
import { check, integer, text, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { mediaSessions } from './media-sessions';

/**
 * The columns every media worker role's lease on one media session has:
 * the session, the holding worker (an identifier, not a bearer), a rising
 * epoch that fences takeover and stale ingress, and its expiry.
 */
export const mediaWorkerLeaseColumns = () => ({
  sessionId: text('session_id')
    .primaryKey()
    .references(() => mediaSessions.id, { onDelete: 'cascade' }),
  workerId: text('worker_id').notNull(),
  epoch: integer('epoch').notNull(),
  expiresAt: timestampColumn('expires_at').notNull(),
});

/** A lease epoch is always positive. */
export const positiveEpochCheck = (table: string, epoch: AnyPgColumn) =>
  check(`${table}_epoch_check`, sql`${epoch} > 0`);
