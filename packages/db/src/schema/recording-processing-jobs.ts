import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import {
  recordingJobStateSchema,
  recordingJobStatuses,
  type RecordingJobState,
} from '@daisy/protocol';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  oneOf,
  timestampColumn,
  updatedAtColumn,
} from './columns';
import { recordings } from './recordings';

/**
 * One Recording's sources and the work on them (REC-1.2). It is the only table
 * the processing worker can reach, so it can claim to have built media but can
 * never make a Recording ready. It exists from the first Egress, so a Recording
 * removed mid-capture still knows what it left in the hold bucket.
 */
export const recordingProcessingJobs = pgTable(
  'recording_processing_jobs',
  {
    recordingId: text('recording_id')
      .primaryKey()
      .references(() => recordings.id, { onDelete: 'restrict' }),
    /** Where the sources wait in the hold bucket; fixed when the job is opened. */
    holdPrefix: text('hold_prefix').notNull(),
    status: text('status').$type<RecordingJobState['status']>().notNull(),
    state: jsonbColumn('state', recordingJobStateSchema).notNull(),
    /**
     * Runs claimed since the job was last queued, counted at the claim so one that
     * dies with its process counts too. A shutdown gives its run back.
     */
    runsStarted: integer('runs_started').notNull().default(0),
    /** A run that does not answer comes due again here: an outage only delays the work. */
    dueAt: timestampColumn('due_at'),
    leaseOwner: text('lease_owner'),
    leaseUntil: timestampColumn('lease_until'),
    /** An operator was told this build ran past its bound; told once, not each pass. */
    delayAlertedAt: timestampColumn('delay_alerted_at'),
    /** Rises with every claim, so a slower former owner can write nothing. */
    leaseEpoch: integer('lease_epoch').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('recording_jobs_claimable_idx')
      .on(table.dueAt)
      .where(sql`${table.status} in ('queued', 'discarding')`),
    index('recording_jobs_answerable_idx')
      .on(table.updatedAt)
      .where(sql`${table.status} <> 'settled'`),
    check(
      'recording_jobs_status_check',
      oneOf(table.status, recordingJobStatuses),
    ),
    jsonbIsObject('recording_processing_jobs', table.state),
    check(
      'recording_jobs_state_status_check',
      sql`${table.state}->>'status' = ${table.status}`,
    ),
    check(
      'recording_jobs_counters_check',
      sql`${table.runsStarted} >= 0 and ${table.leaseEpoch} >= 0`,
    ),
    check(
      'recording_jobs_lease_check',
      sql`(${table.leaseOwner} is null) = (${table.leaseUntil} is null)`,
    ),
  ],
);
