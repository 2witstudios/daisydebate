import { sql } from 'drizzle-orm';
import { bigint, boolean, check, pgTable } from 'drizzle-orm/pg-core';
import { xid8Column } from './columns';

/** One migration-created ordering boundary; no identifiers or personal data. */
export const outboxRetentionBoundary = pgTable(
  'outbox_retention_boundary',
  {
    singleton: boolean('singleton').primaryKey(),
    txid: xid8Column('txid').notNull(),
    seq: bigint('seq', { mode: 'bigint' }).notNull(),
  },
  (t) => [
    check('outbox_retention_boundary_singleton', sql`${t.singleton} = true`),
    check('outbox_retention_boundary_seq', sql`${t.seq} >= 0`),
  ],
);
