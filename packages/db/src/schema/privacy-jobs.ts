import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { timestampColumn, oneOf } from './columns';
import { users } from './users';
import { privacyVendors } from '../privacy/planner';

/** Local intent only. No bearer secrets, payloads, raw vendor errors or PII. */
export const privacyJobs = pgTable(
  'privacy_jobs',
  {
    id: text('id').primaryKey(),
    subjectRef: text('subject_ref')
      .notNull()
      .references(() => users.id),
    vendor: text('vendor').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestampColumn('created_at').notNull(),
    retryAt: timestampColumn('retry_at').notNull(),
    succeededAt: timestampColumn('succeeded_at'),
  },
  (table) => [
    uniqueIndex('privacy_jobs_subject_vendor_unique').on(
      table.subjectRef,
      table.vendor,
    ),
    check('privacy_jobs_vendor_valid', oneOf(table.vendor, privacyVendors)),
    check(
      'privacy_jobs_status_valid',
      oneOf(table.status, ['pending', 'succeeded']),
    ),
    check('privacy_jobs_attempts_nonnegative', sql`${table.attempts} >= 0`),
    check(
      'privacy_jobs_success_consistent',
      sql`(${table.status} = 'succeeded') = (${table.succeededAt} is not null)`,
    ),
  ],
);
