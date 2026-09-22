import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import { timestampColumn } from './columns';
import { debates } from './debates';

/**
 * Durable command idempotency and audit (ADR 0029): the protocol `commandId`
 * keys the row, the payload digest detects a retry with a different body,
 * and `result` is replayed to the caller. A dedupe record, not event
 * sourcing. Exactly one principal is set: an actor or a service.
 */
export const debateCommands = pgTable(
  'debate_commands',
  {
    commandId: text('command_id').primaryKey(),
    debateId: text('debate_id')
      .notNull()
      .references(() => debates.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => actors.id, {
      onDelete: 'restrict',
    }),
    serviceId: text('service_id'),
    type: text('type').notNull(),
    /** SHA3-256 of the canonical payload, lowercase hex. */
    payloadDigest: text('payload_digest').notNull(),
    result: jsonb('result').notNull(),
    resultingVersion: integer('resulting_version').notNull(),
    appliedAt: timestampColumn('applied_at').notNull(),
  },
  (table) => [
    index('debate_commands_debate_version_idx').on(
      table.debateId,
      table.resultingVersion,
    ),
    check(
      'debate_commands_one_principal',
      sql`(${table.actorId} is null) <> (${table.serviceId} is null)`,
    ),
    check(
      'debate_commands_digest_check',
      sql`${table.payloadDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
