import { segmentTypes } from '@daisy/protocol';
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
 * A competitive interval (ADR 0058 §6): one speech or cross-examination,
 * prep is a policy in the rules and never a row here. A row exists because
 * the interval OPENED — `started_at` is set and `ended_at` null — and the
 * partial unique index makes it the one live interval per round. The
 * duration is the resolved value the rules froze, asserted at the open,
 * never free.
 */
export const roundSegments = pgTable(
  'round_segments',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    /** Joins `RoundRules.segments[].key`. */
    rulesSegmentKey: text('rules_segment_key').notNull(),
    /** Not null: a row exists because the interval opened. */
    startedAt: timestampColumn('started_at').notNull(),
    endedAt: timestampColumn('ended_at'),
    durationMs: integer('duration_ms').notNull(),
  },
  (table) => [
    uniqueIndex('round_segments_sequence_unique').on(
      table.roundId,
      table.sequence,
    ),
    uniqueIndex('round_segments_key_unique').on(
      table.roundId,
      table.rulesSegmentKey,
    ),
    /** Target for utterances' consistency witness. */
    uniqueIndex('round_segments_id_round_unique').on(table.id, table.roundId),
    /** The live interval: at most one open row per round. */
    uniqueIndex('round_segments_single_open')
      .on(table.roundId)
      .where(sql`${table.endedAt} is null`),
    index('round_segments_started_idx').on(table.startedAt),
    check('round_segments_type_check', oneOf(table.type, segmentTypes)),
    check('round_segments_sequence_check', sql`${table.sequence} >= 0`),
    check('round_segments_duration_positive', sql`${table.durationMs} > 0`),
  ],
);
