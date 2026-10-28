import { pgTable, text } from 'drizzle-orm/pg-core';
import { retriedJobChecks, retriedJobColumns } from './columns';
import { users } from './users';

/**
 * Durable purge obligations for shared observation caches (ADR 0089), in
 * the vendor-deletion job pattern (`privacy_jobs`): a member's erasure queues
 * one row in its own transaction, and the row turns `succeeded` only after a
 * confirmed purge of every cached observation body. A failed or interrupted
 * attempt stays `pending` and is retried with backoff. Local intent only:
 * the member and counters, no payload, no Redis key, no error.
 */
export const observationPurgeJobs = pgTable(
  'observation_purge_jobs',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...retriedJobColumns(),
  },
  (table) => retriedJobChecks('observation_purge_jobs', table),
);
