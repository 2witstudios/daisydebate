import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAtColumn } from './columns';
import { roundParticipants } from './round-participants';
import { roundSegments } from './round-segments';

/**
 * What was said, in order (ADR 0058 §6, §7). A cross-examination segment
 * holds utterances from two participants; a prep interval holds none,
 * because it is not a row here. `round_id` is a consistency witness: two
 * independent FKs would both succeed on a segment from one round and a
 * speaker from another, so the scoped composite FKs prove the pairing
 * shares a parent — evidence a redundant id must keep, not drop.
 */
export const utterances = pgTable(
  'utterances',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id').notNull(),
    segmentId: text('segment_id').notNull(),
    /** The speaker's seat in this round. */
    roundParticipantId: text('round_participant_id').notNull(),
    sequence: integer('sequence').notNull(),
    text: text('text').notNull(),
    /** False while the speaker's line is still arriving. */
    complete: boolean('complete').notNull().default(true),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({
      name: 'utterances_segment_round_fk',
      columns: [table.segmentId, table.roundId],
      foreignColumns: [roundSegments.id, roundSegments.roundId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'utterances_participant_round_fk',
      columns: [table.roundParticipantId, table.roundId],
      foreignColumns: [roundParticipants.id, roundParticipants.roundId],
    }).onDelete('restrict'),
    uniqueIndex('utterances_segment_sequence_unique').on(
      table.segmentId,
      table.sequence,
    ),
    index('utterances_participant_idx').on(table.roundParticipantId),
    check('utterances_sequence_check', sql`${table.sequence} >= 0`),
    check('utterances_text_length', sql`char_length(${table.text}) <= 20000`),
  ],
);
