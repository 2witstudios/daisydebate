import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, timestampColumn } from './columns';
import { recordings } from './recordings';
import { roundParticipants } from './round-participants';
import { rounds } from './rounds';

/**
 * One debater's own capture for a Recording (REC-1.6): a Participant Egress beside
 * the composite, whichever way that runs. Rows exist only for debaters, chosen from
 * the Round's seats, so a judge can have none. It writes to the private hold alone.
 */
export const recordingPovCaptures = pgTable(
  'recording_pov_captures',
  {
    recordingId: text('recording_id')
      .notNull()
      .references(() => recordings.id, { onDelete: 'restrict' }),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'restrict' }),
    roundParticipantId: text('round_participant_id').notNull(),
    /** False for a bot: it has a voice and nothing to show. */
    camera: boolean('camera').notNull(),
    /** The room the latest Egress joined: a rotation moves the Round, not it. */
    egressRoom: text('egress_room'),
    egressId: text('egress_id'),
    egressStartedAt: timestampColumn('egress_started_at'),
    /** Each Egress attempt holds under its own number, so a restart overwrites nothing. */
    egressGeneration: integer('egress_generation').notNull().default(0),
    observerRevokedAt: timestampColumn('observer_revoked_at'),
    revocationFailures: integer('revocation_failures').notNull().default(0),
    /** The tallest camera seen from this debater: what their POV's label says. */
    cameraHeight: integer('camera_height'),
    /** One web instance reconciles a POV at a time, so one Egress starts. */
    reconcileLeaseUntil: timestampColumn('reconcile_lease_until'),
    /** No Egress runs or will, so the build may read everything it held. */
    endedAt: timestampColumn('ended_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.recordingId, table.roundParticipantId] }),
    foreignKey({
      name: 'recording_pov_captures_participant_round_fk',
      columns: [table.roundParticipantId, table.roundId],
      foreignColumns: [roundParticipants.id, roundParticipants.roundId],
    }).onDelete('no action'),
    index('recording_pov_captures_round_idx').on(table.roundId),
    index('recording_pov_captures_open_idx')
      .on(table.recordingId)
      .where(sql`${table.endedAt} is null`),
    check(
      'recording_pov_captures_counters_check',
      sql`${table.egressGeneration} >= 0 and ${table.revocationFailures} >= 0 and (${table.cameraHeight} is null or ${table.cameraHeight} > 0)`,
    ),
  ],
);
