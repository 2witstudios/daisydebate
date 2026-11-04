import {
  platformIncidentCauses,
  type PlatformIncidentCause,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { rounds } from './rounds';

/**
 * One platform incident on one Round (ADR 0110): the source of the incident
 * rate, the operator's view and the receipt's stated cause. It holds Round ids
 * and instants, and no personal data. An incident is open until it is resumed
 * or ended, never both.
 */
export const roundIncidents = pgTable(
  'round_incidents',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    cause: text('cause').$type<PlatformIncidentCause>().notNull(),
    detectedAt: timestampColumn('detected_at').notNull(),
    /** The end of the speaker's last confirmed audio; null when no speech was open. */
    resumePoint: timestampColumn('resume_point'),
    resumedAt: timestampColumn('resumed_at'),
    endedAt: timestampColumn('ended_at'),
    /** Airtime this incident gave back to the speech it interrupted. */
    returnedMs: integer('returned_ms').notNull().default(0),
  },
  (table) => [
    /** At most one open incident per Round. */
    uniqueIndex('round_incidents_single_open')
      .on(table.roundId)
      .where(sql`${table.resumedAt} is null and ${table.endedAt} is null`),
    index('round_incidents_round_idx').on(table.roundId),
    index('round_incidents_detected_idx').on(table.detectedAt),
    check(
      'round_incidents_cause_check',
      oneOf(table.cause, platformIncidentCauses),
    ),
    check('round_incidents_returned_check', sql`${table.returnedMs} >= 0`),
    check(
      'round_incidents_one_ending_check',
      sql`${table.resumedAt} is null or ${table.endedAt} is null`,
    ),
  ],
);
