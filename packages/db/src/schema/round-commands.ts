import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { actors } from './actors';
import {
  jsonbColumn,
  jsonbIsObject,
  jsonObjectSchema,
  oneOf,
  timestampColumn,
} from './columns';
import { rounds } from './rounds';

/** The legal operations on a running round (ADR 0058 §6). */
export const roundCommandTypes = [
  'start',
  'start_prep',
  'start_speech',
  'yield',
  'interrupt',
  'forfeit',
  'complete',
] as const;

/**
 * Durable command idempotency and audit (ADR 0029, ADR 0058): the
 * protocol `commandId` keys the row, the payload digest detects a retry
 * with a different body, and `result` is replayed to the caller. A dedupe
 * record, not event sourcing. Exactly one principal is set: an actor or a
 * service. `interrupt` is present because a rule ECS cannot receive a
 * command for is a rule it can never exercise; the log records the legal
 * action, not the mechanism that triggered it.
 */
export const roundCommands = pgTable(
  'round_commands',
  {
    commandId: text('command_id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => actors.id, {
      onDelete: 'restrict',
    }),
    serviceId: text('service_id'),
    type: text('type').notNull(),
    /** SHA3-256 of the canonical payload, lowercase hex. */
    payloadDigest: text('payload_digest').notNull(),
    result: jsonbColumn('result', jsonObjectSchema).notNull(),
    resultingVersion: integer('resulting_version').notNull(),
    appliedAt: timestampColumn('applied_at').notNull(),
  },
  (table) => [
    index('round_commands_round_version_idx').on(
      table.roundId,
      table.resultingVersion,
    ),
    index('round_commands_actor_idx').on(table.actorId),
    jsonbIsObject('round_commands', table.result),
    check(
      'round_commands_one_principal',
      sql`(${table.actorId} is null) <> (${table.serviceId} is null)`,
    ),
    check(
      'round_commands_digest_check',
      sql`${table.payloadDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check('round_commands_type_check', oneOf(table.type, roundCommandTypes)),
  ],
);
