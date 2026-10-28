import { check, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { oneOf, retriedJobChecks, retriedJobColumns } from './columns';
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
    ...retriedJobColumns(),
  },
  (table) => [
    uniqueIndex('privacy_jobs_subject_vendor_unique').on(
      table.subjectRef,
      table.vendor,
    ),
    check('privacy_jobs_vendor_valid', oneOf(table.vendor, privacyVendors)),
    ...retriedJobChecks('privacy_jobs', table),
  ],
);
