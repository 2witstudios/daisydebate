import { frozenCaptureGapsSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { jsonbColumn, jsonbIsObject, oneOf, timestampColumn } from './columns';
import { rounds } from './rounds';

/** A one-time frozen input. Eligibility and coverage are checked by the finalizer. */
export const roundTranscriptFreezes = pgTable(
  'round_transcript_freezes',
  {
    roundId: text('round_id')
      .primaryKey()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    frontier: integer('frontier').notNull(),
    frozenAt: timestampColumn('frozen_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    completeness: text('completeness')
      .$type<'complete' | 'incomplete'>()
      .notNull(),
    /** Speech the played segments owed, for the published capture coverage. */
    expectedSpeechMs: integer('expected_speech_ms').notNull().default(0),
    /** Speech lost; null when a stream fell short by an unmeasured amount. */
    captureGapMs: integer('capture_gap_ms'),
    /** Each gap as offsets into its speech, given to the judge in plain words. */
    captureGaps: jsonbColumn('capture_gaps', frozenCaptureGapsSchema)
      .notNull()
      .default({ gaps: [] }),
  },
  (table) => [
    uniqueIndex('round_transcript_freezes_round_revision_unique').on(
      table.roundId,
      table.revision,
    ),
    check(
      'round_transcript_freezes_revision_check',
      sql`${table.revision} > 0 and ${table.frontier} >= 0`,
    ),
    check(
      'round_transcript_freezes_completeness_check',
      oneOf(table.completeness, ['complete', 'incomplete']),
    ),
    jsonbIsObject('round_transcript_freezes', table.captureGaps),
  ],
);
