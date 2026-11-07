import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { billingCleanupSchema } from '@daisy/protocol/billing';
import {
  oneOf,
  retriedJobChecks,
  retriedJobColumns,
  jsonbColumnNullable,
  jsonbIsObject,
} from './columns';
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
    billingCleanup: jsonbColumnNullable(
      'billing_cleanup',
      billingCleanupSchema,
    ),
    ...retriedJobColumns(),
  },
  (table) => [
    uniqueIndex('privacy_jobs_subject_vendor_unique').on(
      table.subjectRef,
      table.vendor,
    ),
    index('privacy_jobs_pending_vendor_due_idx')
      .on(table.vendor, table.retryAt, table.id)
      .where(sql`${table.status}='pending'`),
    check('privacy_jobs_vendor_valid', oneOf(table.vendor, privacyVendors)),
    jsonbIsObject('privacy_jobs', table.billingCleanup),
    check(
      'privacy_jobs_billing_cleanup_scope',
      sql`${table.billingCleanup} is null or
      coalesce((${table.vendor}='stripe' and ${table.billingCleanup}->>'jobId'=${table.id}
        and case ${table.billingCleanup}->>'kind'
          when 'acknowledged' then ${table.status}='succeeded'
          when 'scanning' then ${table.status}='pending'
          when 'deleting' then ${table.status}='pending'
          else false end),false)`,
    ),
    ...retriedJobChecks('privacy_jobs', table),
  ],
);
