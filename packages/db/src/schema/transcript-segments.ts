import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { mediaSessions } from './media-sessions';
import { roundParticipants } from './round-participants';
import { roundSegments } from './round-segments';
import { rounds } from './rounds';

/** The committed transcript frontier advances only under the owning Round lock. */
export const roundTranscripts = pgTable(
  'round_transcripts',
  {
    roundId: text('round_id')
      .primaryKey()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull().default(0),
  },
  (table) => [
    check('round_transcripts_revision_check', sql`${table.revision} >= 0`),
  ],
);

/** One expected stream is a durable segment/seat pair, independent of tracks. */
export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    roundId: text('round_id').notNull(),
    segmentId: text('segment_id').notNull(),
    roundParticipantId: text('round_participant_id').notNull(),
    state: text('state')
      .$type<'open' | 'complete' | 'partial'>()
      .notNull()
      .default('open'),
    chunkCount: integer('chunk_count').notNull().default(0),
    sealedChunkCount: integer('sealed_chunk_count'),
    sealedAt: timestampColumn('sealed_at'),
  },
  (table) => [
    primaryKey({ columns: [table.segmentId, table.roundParticipantId] }),
    uniqueIndex('transcript_segments_stream_round_unique').on(
      table.segmentId,
      table.roundParticipantId,
      table.roundId,
    ),
    foreignKey({
      name: 'transcript_segments_segment_round_fk',
      columns: [table.segmentId, table.roundId],
      foreignColumns: [roundSegments.id, roundSegments.roundId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transcript_segments_participant_round_fk',
      columns: [table.roundParticipantId, table.roundId],
      foreignColumns: [roundParticipants.id, roundParticipants.roundId],
    }).onDelete('no action'),
    index('transcript_segments_segment_round_idx').on(
      table.segmentId,
      table.roundId,
    ),
    index('transcript_segments_participant_round_idx').on(
      table.roundParticipantId,
      table.roundId,
    ),
    index('transcript_segments_round_idx').on(table.roundId),
    check(
      'transcript_segments_state_check',
      oneOf(table.state, ['open', 'complete', 'partial']),
    ),
    check(
      'transcript_segments_counts_check',
      sql`${table.chunkCount} >= 0 and (${table.sealedChunkCount} is null or ${table.sealedChunkCount} >= 0)`,
    ),
    check(
      'transcript_segments_seal_check',
      sql`(${table.state} = 'open' and ${table.sealedAt} is null and ${table.sealedChunkCount} is null) or (${table.state} <> 'open' and ${table.sealedAt} is not null and ${table.sealedChunkCount} is not null)`,
    ),
    check(
      'transcript_segments_complete_count_check',
      sql`${table.state} <> 'complete' or ${table.chunkCount} = ${table.sealedChunkCount}`,
    ),
  ],
);

/** Trusted server observation coverage; the worker keeps all PCM in memory. */
export const transcriptObservations = pgTable(
  'transcript_observations',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id').notNull(),
    segmentId: text('segment_id').notNull(),
    roundParticipantId: text('round_participant_id').notNull(),
    trackId: text('track_id').notNull(),
    workerEpoch: integer('worker_epoch').notNull(),
    observedFrom: timestampColumn('observed_from').notNull(),
    observedUntil: timestampColumn('observed_until').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'transcript_observations_stream_round_fk',
      columns: [table.segmentId, table.roundParticipantId, table.roundId],
      foreignColumns: [
        transcriptSegments.segmentId,
        transcriptSegments.roundParticipantId,
        transcriptSegments.roundId,
      ],
    }).onDelete('cascade'),
    index('transcript_observations_stream_round_idx').on(
      table.segmentId,
      table.roundParticipantId,
      table.roundId,
      table.observedFrom,
    ),
    check(
      'transcript_observations_range_check',
      sql`${table.observedUntil} > ${table.observedFrom}`,
    ),
    check('transcript_observations_epoch_check', sql`${table.workerEpoch} > 0`),
    check(
      'transcript_observations_track_check',
      sql`char_length(${table.trackId}) between 1 and 128`,
    ),
  ],
);

/** Rising epochs fence server capture. worker_id is an identifier, not a bearer. */
export const mediaWorkerLeases = pgTable(
  'media_worker_leases',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => mediaSessions.id, { onDelete: 'cascade' }),
    workerId: text('worker_id').notNull(),
    epoch: integer('epoch').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
  },
  (table) => [
    check('media_worker_leases_epoch_check', sql`${table.epoch} > 0`),
  ],
);
