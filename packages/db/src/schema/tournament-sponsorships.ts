import { sql } from 'drizzle-orm';
import { historyAuthoritySchema } from '@daisy/protocol/lobby/command';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, jsonbColumn, jsonbIsObject } from './columns';
import { tournaments } from './lobbies';
import { users } from './users';
import { accountHostingEntitlementVersions } from './hosting-entitlement-versions';

/** Dual authorization is append-only; the latest lobby version is its current funding direction. */
export const tournamentSponsorshipVersions = pgTable(
  'tournament_sponsorship_versions',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id')
      .notNull()
      .references(() => tournaments.lobbyId, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    sponsorUserId: text('sponsor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    actedByUserId: text('acted_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    authority: jsonbColumn('authority', historyAuthoritySchema).notNull(),
    kind: text('kind').notNull(),
    previousVersionId: text('previous_version_id'),
    hostingVersionId: text('hosting_version_id').references(
      () => accountHostingEntitlementVersions.id,
      { onDelete: 'restrict' },
    ),
    reason: text('reason'),
    createdAt: createdAtColumn(),
  },
  (table): PgTableExtraConfigValue[] => [
    unique('tournament_sponsorship_versions_id_lobby_unique').on(
      table.id,
      table.lobbyId,
    ),
    unique('tournament_sponsorship_versions_lobby_version_unique').on(
      table.lobbyId,
      table.version,
    ),
    index('tournament_sponsorship_versions_sponsor_idx').on(
      table.sponsorUserId,
    ),
    index('tournament_sponsorship_versions_actor_idx').on(table.actedByUserId),
    index('tournament_sponsorship_versions_previous_idx').on(
      table.previousVersionId,
      table.lobbyId,
    ),
    index('tournament_sponsorship_versions_hosting_idx').on(
      table.hostingVersionId,
    ),
    foreignKey({
      name: 'tournament_sponsorship_versions_previous_fk',
      columns: [table.previousVersionId, table.lobbyId],
      foreignColumns: [table.id, table.lobbyId],
    }).onDelete('restrict'),
    jsonbIsObject('tournament_sponsorship_versions', table.authority),
    check(
      'tournament_sponsorship_versions_version_positive',
      sql`${table.version}>0`,
    ),
    check(
      'tournament_sponsorship_versions_shape',
      sql`
  (${table.kind}='proposed' and ${table.hostingVersionId} is null and ${table.reason} is null)
  or (${table.kind}='active' and ${table.previousVersionId} is not null and ${table.hostingVersionId} is not null and ${table.reason} is null and ${table.actedByUserId}=${table.sponsorUserId})
  or (${table.kind}='revoked' and ${table.previousVersionId} is not null and ${table.hostingVersionId} is null and ${table.reason} is not null and length(btrim(${table.reason})) between 1 and 500)`,
    ),
  ],
);
