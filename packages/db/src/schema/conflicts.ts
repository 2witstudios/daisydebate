import {
  conflictBases,
  conflictHandlings,
  pendingCommandStatuses,
} from '@daisy/protocol/lobby';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  jsonObjectSchema,
  oneOf,
  timestampColumn,
} from './columns';
import { fixtures } from './fixtures';
import { lobbies } from './lobbies';
import { digestCheck, nonEmpty } from './tenant-keys';
import { users } from './users';

/**
 * A person with authority is connected to a fixture's Room: seated in it,
 * or their school's entry or their child is, or it was declared. Always
 * recorded, even when its command is refused, with the `conflict.handling`
 * that applied at that moment. Append-only: a confirmation is a new row
 * carrying the confirmer, and that row is the waiver the evaluator reads.
 */
export const conflicts = pgTable(
  'conflicts',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    fixtureId: text('fixture_id').notNull(),
    basis: text('basis').$type<(typeof conflictBases)[number]>().notNull(),
    handling: text('handling')
      .$type<(typeof conflictHandlings)[number]>()
      .notNull(),
    confirmedByUserId: text('confirmed_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    detectedAt: timestampColumn('detected_at').notNull(),
  },
  (table) => [
    unique('conflicts_id_lobby_unique').on(table.id, table.lobbyId),
    index('conflicts_fixture_idx').on(table.fixtureId, table.lobbyId),
    index('conflicts_user_idx').on(table.userId),
    index('conflicts_confirmed_by_user_idx').on(table.confirmedByUserId),
    foreignKey({
      name: 'conflicts_fixture_fk',
      columns: [table.fixtureId, table.lobbyId],
      foreignColumns: [fixtures.id, fixtures.lobbyId],
    }).onDelete('restrict'),
    check('conflicts_basis_check', oneOf(table.basis, conflictBases)),
    check('conflicts_handling_check', oneOf(table.handling, conflictHandlings)),
    check(
      'conflicts_confirmer_check',
      sql`${table.confirmedByUserId} is null or (${table.handling} = 'second_confirms' and ${table.confirmedByUserId} <> ${table.userId})`,
    ),
  ],
);

/**
 * A command held for a second person's confirmation, stored whole under its
 * proposer's command id. Confirming re-runs the stored command against
 * current versions, which then writes its own action history row. It is
 * settled at most once, by trigger, and a confirmation or a decline is never
 * the proposer's own.
 */
export const pendingCommands = pgTable(
  'pending_commands',
  {
    commandId: text('command_id').primaryKey(),
    lobbyId: text('lobby_id')
      .notNull()
      .references(() => lobbies.id, { onDelete: 'restrict' }),
    proposerUserId: text('proposer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    payload: jsonbColumn('payload', jsonObjectSchema).notNull(),
    payloadDigest: text('payload_digest').notNull(),
    /** The versions the proposer read. */
    expected: jsonbColumn('expected', jsonObjectSchema).notNull(),
    conflictId: text('conflict_id').notNull(),
    status: text('status')
      .$type<(typeof pendingCommandStatuses)[number]>()
      .notNull()
      .default('pending'),
    expiresAt: timestampColumn('expires_at').notNull(),
    settledAt: timestampColumn('settled_at'),
    settledByUserId: text('settled_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('pending_commands_lobby_idx').on(table.lobbyId, table.status),
    index('pending_commands_proposer_user_idx').on(table.proposerUserId),
    index('pending_commands_conflict_idx').on(table.conflictId, table.lobbyId),
    index('pending_commands_settled_by_user_idx').on(table.settledByUserId),
    foreignKey({
      name: 'pending_commands_conflict_fk',
      columns: [table.conflictId, table.lobbyId],
      foreignColumns: [conflicts.id, conflicts.lobbyId],
    }).onDelete('restrict'),
    check(
      'pending_commands_status_check',
      oneOf(table.status, pendingCommandStatuses),
    ),
    check(
      'pending_commands_settled_consistent',
      sql`(${table.status} <> 'pending') = (${table.settledAt} is not null)`,
    ),
    // A person settles it, except a lapse, which nobody does.
    check(
      'pending_commands_settler_check',
      sql`(${table.status} in ('confirmed', 'declined', 'withdrawn')) = (${table.settledByUserId} is not null)`,
    ),
    check(
      'pending_commands_second_person',
      sql`case when ${table.status} in ('confirmed', 'declined') then ${table.settledByUserId} <> ${table.proposerUserId}
        when ${table.status} = 'withdrawn' then ${table.settledByUserId} = ${table.proposerUserId}
        else true end`,
    ),
    nonEmpty('pending_commands_type_nonempty', table.type),
    digestCheck('pending_commands_digest_check', table.payloadDigest),
    jsonbIsObject('pending_commands', table.payload),
    jsonbIsObject('pending_commands', table.expected),
  ],
);
