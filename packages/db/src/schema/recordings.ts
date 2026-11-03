import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  recordingClasses,
  recordingEligibilitySchema,
  recordingLifecycleSchema,
  recordingStatuses,
  type RecordingClass,
  type RecordingStatus,
} from '@daisy/protocol';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { rounds } from './rounds';

/**
 * A retained playable video of a Round (ADR 0107). It is not a Broadcast and
 * shares nothing with one. One Recording per Round, with a stable id derived
 * media can name. `lifecycle` is the whole state as one value; `status` repeats
 * its tag so the jobs can index it, and a check keeps the two equal. Its deletion
 * intent lives here, so a removal cannot be lost when a process dies. A Round with
 * a Recording cannot be deleted, or its objects would have no owner.
 */
export const recordings = pgTable(
  'recordings',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'restrict' }),
    /** Fixed when requested: it decides what a participant may remove. */
    recordingClass: text('recording_class').$type<RecordingClass>().notNull(),
    eligibility: jsonbColumn(
      'eligibility',
      recordingEligibilitySchema,
    ).notNull(),
    status: text('status').$type<RecordingStatus>().notNull(),
    lifecycle: jsonbColumn('lifecycle', recordingLifecycleSchema).notNull(),
    version: versionColumn(),
    deletionAttempts: integer('deletion_attempts').notNull().default(0),
    deletionDueAt: timestampColumn('deletion_due_at'),
    leaseOwner: text('lease_owner'),
    leaseUntil: timestampColumn('lease_until'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('recordings_round_unique').on(table.roundId),
    index('recordings_status_idx').on(table.status, table.updatedAt),
    index('recordings_deletion_due_idx')
      .on(table.deletionDueAt)
      .where(sql`${table.status} = 'removing'`),
    check(
      'recordings_class_check',
      oneOf(table.recordingClass, recordingClasses),
    ),
    check('recordings_status_check', oneOf(table.status, recordingStatuses)),
    jsonbIsObject('recordings', table.eligibility),
    jsonbIsObject('recordings', table.lifecycle),
    check(
      'recordings_lifecycle_status_check',
      sql`${table.lifecycle}->>'status' = ${table.status}`,
    ),
    check(
      'recordings_class_matches_eligibility_check',
      sql`(${table.recordingClass} = 'ranked') = (${table.eligibility}->>'kind' = 'ranked')`,
    ),
    check(
      'recordings_deletion_attempts_check',
      sql`${table.deletionAttempts} >= 0`,
    ),
    check(
      'recordings_lease_check',
      sql`(${table.leaseOwner} is null) = (${table.leaseUntil} is null)`,
    ),
    versionPositive('recordings', table.version),
  ],
);
