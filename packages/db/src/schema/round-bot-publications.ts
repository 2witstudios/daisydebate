import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { agentRuns } from './agent-runs';
import { roundParticipants } from './round-participants';
import { roundSegments } from './round-segments';
import { rounds } from './rounds';

/** One durable per-seat publication epoch, independent of transcript credit. */
export const roundBotPublications = pgTable(
  'round_bot_publications',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    roundParticipantId: text('round_participant_id').notNull(),
    segmentId: text('segment_id').notNull(),
    agentRunId: text('agent_run_id').notNull(),
    serviceId: text('service_id').notNull(),
    publicationEpoch: integer('publication_epoch').notNull(),
    leaseTokenDigest: text('lease_token_digest').notNull(),
    leaseExpiresAt: timestampColumn('lease_expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.roundParticipantId] }),
    foreignKey({
      name: 'round_bot_publications_seat_round_fk',
      columns: [table.roundParticipantId, table.roundId],
      foreignColumns: [roundParticipants.id, roundParticipants.roundId],
    }),
    foreignKey({
      name: 'round_bot_publications_segment_round_fk',
      columns: [table.segmentId, table.roundId],
      foreignColumns: [roundSegments.id, roundSegments.roundId],
    }),
    foreignKey({
      name: 'round_bot_publications_run_seat_fk',
      columns: [table.agentRunId, table.roundParticipantId],
      foreignColumns: [agentRuns.id, agentRuns.roundParticipantId],
    }),
    index('round_bot_publications_seat_round_idx').on(
      table.roundParticipantId,
      table.roundId,
    ),
    index('round_bot_publications_segment_round_idx').on(
      table.segmentId,
      table.roundId,
    ),
    index('round_bot_publications_run_seat_idx').on(
      table.agentRunId,
      table.roundParticipantId,
    ),
    check(
      'round_bot_publications_epoch_check',
      sql`${table.publicationEpoch} > 0`,
    ),
    check(
      'round_bot_publications_digest_check',
      sql`${table.leaseTokenDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'round_bot_publications_service_check',
      sql`${table.serviceId} = 'agent-run:' || ${table.agentRunId}`,
    ),
  ],
);
