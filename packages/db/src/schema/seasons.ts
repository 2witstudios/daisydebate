import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { lobbies } from './lobbies';
import { constantText } from './tenant-keys';

export const seasonStatuses = ['active', 'closed'] as const;

export const seasons = pgTable(
  'seasons',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    activationKey: text('activation_key'),
    startsAt: timestampColumn('starts_at').notNull(),
    endsAt: timestampColumn('ends_at'),
    status: text('status').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
    lobbyId: text('lobby_id').notNull(),
    lobbyKind: constantText('lobby_kind', 'standing'),
    organizationId: text('organization_id').notNull(),
  },
  (table) => [
    uniqueIndex('seasons_single_active')
      .on(table.lobbyId)
      .where(sql`${table.status} = 'active'`),
    unique('seasons_id_lobby_unique').on(table.id, table.lobbyId),
    foreignKey({
      name: 'seasons_lobby_owner_fk',
      columns: [table.lobbyId, table.organizationId],
      foreignColumns: [lobbies.id, lobbies.ownerOrganizationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'seasons_standing_lobby_fk',
      columns: [table.lobbyId, table.lobbyKind],
      foreignColumns: [lobbies.id, lobbies.kind],
    }).onDelete('restrict'),
    index('seasons_lobby_organization_idx').on(
      table.lobbyId,
      table.organizationId,
    ),
    index('seasons_lobby_kind_idx').on(table.lobbyId, table.lobbyKind),
    unique('seasons_id_organization_unique').on(table.id, table.organizationId),
    unique('seasons_activation_key_lobby_unique').on(
      table.activationKey,
      table.lobbyId,
    ),
    index('seasons_organization_idx').on(table.organizationId),
    /** An open season has no end; a set end comes strictly after the start. */
    check(
      'seasons_ends_after_starts',
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check('seasons_status_check', oneOf(table.status, seasonStatuses)),
    versionPositive('seasons', table.version),
  ],
);
