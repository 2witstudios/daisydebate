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
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { lobbies } from './lobbies';
import { organizations } from './organizations';
import { seasons } from './ratings';
import { nonEmpty, oneTenantKey } from './tenant-keys';

/**
 * A league's or a lobby's resolutions. Owned by exactly one organization or
 * one lobby; an organization's pool may belong to one of its seasons.
 */
export const resolutionPools = pgTable(
  'resolution_pools',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'restrict',
    }),
    lobbyId: text('lobby_id').references(() => lobbies.id, {
      onDelete: 'restrict',
    }),
    seasonId: text('season_id'),
    name: text('name').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('resolution_pools_id_organization_unique').on(
      table.id,
      table.organizationId,
    ),
    unique('resolution_pools_id_lobby_unique').on(table.id, table.lobbyId),
    index('resolution_pools_organization_idx').on(table.organizationId),
    index('resolution_pools_lobby_idx').on(table.lobbyId),
    index('resolution_pools_season_idx').on(
      table.seasonId,
      table.organizationId,
    ),
    foreignKey({
      name: 'resolution_pools_season_fk',
      columns: [table.seasonId, table.organizationId],
      foreignColumns: [seasons.id, seasons.organizationId],
    }).onDelete('restrict'),
    oneTenantKey('resolution_pools', table.organizationId, table.lobbyId),
    check(
      'resolution_pools_season_is_organizations',
      sql`${table.seasonId} is null or ${table.organizationId} is not null`,
    ),
    nonEmpty('resolution_pools_name_nonempty', table.name),
    versionPositive('resolution_pools', table.version),
  ],
);

/**
 * One wording in a pool. The wording never changes, by trigger; a wording is
 * retired, never deleted, because tab rounds name it.
 */
export const poolResolutions = pgTable(
  'pool_resolutions',
  {
    id: text('id').primaryKey(),
    poolId: text('pool_id').notNull(),
    organizationId: text('organization_id'),
    lobbyId: text('lobby_id'),
    text: text('text').notNull(),
    retiredAt: timestampColumn('retired_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('pool_resolutions_id_pool_unique').on(table.id, table.poolId),
    index('pool_resolutions_pool_organization_idx').on(
      table.poolId,
      table.organizationId,
    ),
    index('pool_resolutions_pool_lobby_idx').on(table.poolId, table.lobbyId),
    foreignKey({
      name: 'pool_resolutions_organization_pool_fk',
      columns: [table.poolId, table.organizationId],
      foreignColumns: [resolutionPools.id, resolutionPools.organizationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pool_resolutions_lobby_pool_fk',
      columns: [table.poolId, table.lobbyId],
      foreignColumns: [resolutionPools.id, resolutionPools.lobbyId],
    }).onDelete('restrict'),
    oneTenantKey('pool_resolutions', table.organizationId, table.lobbyId),
    // The bounds of a published resolution.
    check(
      'pool_resolutions_text_length',
      sql`length(trim(${table.text})) between 1 and 300`,
    ),
  ],
);
