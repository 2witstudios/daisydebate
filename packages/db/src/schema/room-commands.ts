import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { actors } from './actors';
import {
  jsonbColumn,
  jsonbIsObject,
  jsonObjectSchema,
  timestampColumn,
} from './columns';
import { rooms } from './rooms';

/** Accepted commands only; refusals and exact retries append nothing. */
export const roomCommands = pgTable(
  'room_commands',
  {
    commandId: text('command_id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    payloadDigest: text('payload_digest').notNull(),
    result: jsonbColumn('result', jsonObjectSchema).notNull(),
    resultingVersion: integer('resulting_version').notNull(),
    appliedAt: timestampColumn('applied_at').notNull(),
  },
  (table) => [
    index('room_commands_room_idx').on(table.roomId, table.appliedAt),
    index('room_commands_actor_idx').on(table.actorId),
    index('room_commands_applied_idx').on(table.appliedAt),
    check(
      'room_commands_digest_check',
      sql`${table.payloadDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check('room_commands_version_positive', sql`${table.resultingVersion} > 0`),
    jsonbIsObject('room_commands', table.result),
  ],
);
