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
    clipKey: text('clip_key'),
    captureTrackId: text('capture_track_id'),
    captureStartOffsetMs: integer('capture_start_offset_ms'),
    captureDurationMs: integer('capture_duration_ms'),
    captureWorkerEpoch: integer('capture_worker_epoch'),
    captureBodyDigest: text('capture_body_digest'),
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
    }).onDelete('no action'),
    uniqueIndex('utterances_segment_sequence_unique').on(
      table.segmentId,
      table.sequence,
    ),
    uniqueIndex('utterances_capture_clip_unique').on(table.clipKey),
    uniqueIndex('utterances_capture_position_unique').on(
      table.segmentId,
      table.roundParticipantId,
      table.captureTrackId,
      table.captureStartOffsetMs,
    ),
    index('utterances_participant_idx').on(table.roundParticipantId),
    // Both composite foreign keys, leading with their own columns; the
    // segment index above leads with segment_id alone, which covers neither.
    index('utterances_segment_round_idx').on(table.segmentId, table.roundId),
    index('utterances_participant_round_idx').on(
      table.roundParticipantId,
      table.roundId,
    ),
    // The 180-day retention sweep scans oldest first (ISSUE-498).
    index('utterances_created_at_idx').on(table.createdAt),
    check(
      'utterances_capture_pair_check',
      sql`(${table.clipKey} is null and ${table.captureTrackId} is null and ${table.captureStartOffsetMs} is null and ${table.captureDurationMs} is null and ${table.captureWorkerEpoch} is null and ${table.captureBodyDigest} is null) or (${table.clipKey} is not null and ${table.captureTrackId} is not null and ${table.captureStartOffsetMs} is not null and ${table.captureDurationMs} is not null and ${table.captureWorkerEpoch} is not null and ${table.captureBodyDigest} is not null)`,
    ),
    check(
      'utterances_capture_metadata_check',
      sql`${table.clipKey} is null or (${table.clipKey} ~ '^[0-9a-f]{64}$' and ${table.captureBodyDigest} ~ '^[0-9a-f]{64}$' and char_length(${table.captureTrackId}) between 1 and 128 and ${table.captureStartOffsetMs} >= 0 and ${table.captureDurationMs} > 0 and ${table.captureDurationMs} <= 60000 and ${table.captureWorkerEpoch} > 0)`,
    ),
    check('utterances_sequence_check', sql`${table.sequence} >= 0`),
    check('utterances_text_length', sql`char_length(${table.text}) <= 20000`),
  ],
);
