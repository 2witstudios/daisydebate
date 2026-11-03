import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { controlLapseRecordSchema } from '@daisy/protocol';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  timestampColumn,
} from './columns';
import { recordings } from './recordings';
import { rounds } from './rounds';

/**
 * The Egress a Recording runs itself, when its Round has no Broadcast (REC-1.2):
 * a casual host who opted into recording alone. A Round with a Broadcast has no
 * row here: its Recording reads that Broadcast's Egress. Same stage page and
 * same privacy rule, with its own credential and its own reconcile lease.
 */
export const recordingCaptures = pgTable(
  'recording_captures',
  {
    recordingId: text('recording_id')
      .primaryKey()
      .references(() => recordings.id, { onDelete: 'restrict' }),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'restrict' }),
    egressId: text('egress_id'),
    egressStartedAt: timestampColumn('egress_started_at'),
    /** Each Egress attempt holds under its own number, so a restart overwrites nothing. */
    egressGeneration: integer('egress_generation').notNull().default(0),
    /** SHA3-256 of the current attempt's stage secret; the secret is never stored. */
    stageCredentialHash: text('stage_credential_hash'),
    observerRevokedAt: timestampColumn('observer_revoked_at'),
    revocationFailures: integer('revocation_failures').notNull().default(0),
    /** One web instance reconciles a capture at a time, so one Egress starts. */
    reconcileLeaseUntil: timestampColumn('reconcile_lease_until'),
    /** When the control plane last reached this capture, by the database's clock. */
    controlHeartbeatAt: timestampColumn('control_heartbeat_at'),
    /** Every stretch with no heartbeat: media captured in one is never built. */
    controlLapses: jsonbColumn('control_lapses', controlLapseRecordSchema)
      .notNull()
      .default({ lapses: [] }),
    /** No Egress runs and none will: the stage refuses and the observer is gone. */
    endedAt: timestampColumn('ended_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('recording_captures_round_unique').on(table.roundId),
    jsonbIsObject('recording_captures', table.controlLapses),
    check(
      'recording_captures_counters_check',
      sql`${table.egressGeneration} >= 0 and ${table.revocationFailures} >= 0`,
    ),
  ],
);
