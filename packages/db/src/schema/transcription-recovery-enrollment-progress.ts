import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
/** One private finite-pass position. No source acceptance, payload or reusable execution permission. */
export const transcriptionRecoveryEnrollmentProgress = pgTable(
  'transcription_recovery_enrollment_progress',
  {
    singleton: boolean('singleton').primaryKey(),
    afterAt: timestampColumn('after_at'),
    afterRoundId: text('after_round_id'),
    untilAt: timestampColumn('until_at'),
    untilRoundId: text('until_round_id'),
    nextScanAt: timestampColumn('next_scan_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'transcription_recovery_enrollment_progress_singleton',
      sql`${t.singleton}=true`,
    ),
    check(
      'transcription_recovery_enrollment_progress_position_check',
      sql`(${t.afterAt} is null and ${t.afterRoundId} is null and ${t.untilAt} is null and ${t.untilRoundId} is null) or (${t.afterAt} is not null and ${t.afterRoundId} ~ '^[a-z0-9]{24}$' and ${t.afterRoundId} is not null and ${t.untilAt} is not null and ${t.untilRoundId} ~ '^[a-z0-9]{24}$' and ${t.untilRoundId} is not null and (${t.afterAt},${t.afterRoundId})<=(${t.untilAt},${t.untilRoundId}))`,
    ),
  ],
);
