import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { mediaSessions } from './media-sessions';

/**
 * The bot listener's own lease on a media session (ISSUE-764): the role that
 * relays a peer's live audio activity to a bot debater in cross-examination.
 * Apart from the capture lease, so capture authority never admits bot
 * listening. Rotation of the session's vendor room fences it like every
 * other media worker lease.
 */
export const botListenerLeases = pgTable(
  'bot_listener_leases',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => mediaSessions.id, { onDelete: 'cascade' }),
    workerId: text('worker_id').notNull(),
    epoch: integer('epoch').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
  },
  (table) => [
    check('bot_listener_leases_epoch_check', sql`${table.epoch} > 0`),
  ],
);
