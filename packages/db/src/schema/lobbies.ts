import { listedWord } from '../lifecycle-sql';
import { lobbyKinds, tournamentStatuses } from '@daisy/protocol/lobby';
import { lobbyAgeRules } from '@daisy/protocol/lobby/eligibility';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
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
import { organizations } from './organizations';
import { constantText, nonEmpty } from './tenant-keys';
import { users } from './users';

export const lobbyAgeRule = pgEnum('lobby_age_rule', lobbyAgeRules);

/**
 * The one container of Rooms: `standing` (open-ended) or `tournament`
 * (bounded, with a schedule). Grants, settings and restrictions key on it.
 * Exactly one owner: a league always for a standing lobby, a person or a
 * league for a tournament, never a school. There is no access column: who
 * may see and join is the lobby's `audience.posting` setting. `version` also
 * guards the `tournaments` extension row; `settings_version` guards this
 * scope's settings.
 */
export const lobbies = pgTable(
  'lobbies',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<(typeof lobbyKinds)[number]>().notNull(),
    ownerUserId: text('owner_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    ownerOrganizationId: text('owner_organization_id'),
    /** Proves by foreign key that an owning organization is a league. */
    ownerOrganizationKind: constantText('owner_organization_kind', 'league'),
    name: text('name').notNull(),
    handle: text('handle').notNull(),
    ageRule: lobbyAgeRule('age_rule').default('adults'),
    standingLobbyId: text('standing_lobby_id'),
    standingLobbyKind: constantText('standing_lobby_kind', 'standing'),
    closedAt: timestampColumn('closed_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
    settingsVersion: integer('settings_version').notNull().default(1),
  },
  (table) => [
    unique('lobbies_id_kind_unique').on(table.id, table.kind),
    unique('lobbies_id_owner_organization_unique').on(
      table.id,
      table.ownerOrganizationId,
    ),
    uniqueIndex('lobbies_handle_unique').on(sql`lower(${table.handle})`),
    index('lobbies_owner_user_idx').on(table.ownerUserId),
    index('lobbies_owner_organization_idx').on(
      table.ownerOrganizationId,
      table.ownerOrganizationKind,
    ),
    foreignKey({
      name: 'lobbies_owner_league_fk',
      columns: [table.ownerOrganizationId, table.ownerOrganizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lobbies_standing_parent_kind_fk',
      columns: [table.standingLobbyId, table.standingLobbyKind],
      foreignColumns: [table.id, table.kind],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lobbies_standing_parent_league_fk',
      columns: [table.standingLobbyId, table.ownerOrganizationId],
      foreignColumns: [table.id, table.ownerOrganizationId],
    }).onDelete('restrict'),
    index('lobbies_standing_parent_kind_idx').on(
      table.standingLobbyId,
      table.standingLobbyKind,
    ),
    index('lobbies_standing_parent_league_idx').on(
      table.standingLobbyId,
      table.ownerOrganizationId,
    ),
    check(
      'lobbies_age_rule_source',
      sql`case when ${table.kind} = ${listedWord(lobbyKinds, 'tournament')} and ${table.ownerOrganizationId} is not null
        then ${table.standingLobbyId} is not null and ${table.ageRule} is null
        else ${table.standingLobbyId} is null and ${table.ageRule} is not null end`,
    ),
    check('lobbies_kind_check', oneOf(table.kind, lobbyKinds)),
    check(
      'lobbies_one_owner',
      sql`num_nonnulls(${table.ownerUserId}, ${table.ownerOrganizationId}) = 1`,
    ),
    check(
      'lobbies_standing_is_organization_owned',
      sql`${table.kind} <> ${listedWord(lobbyKinds, 'standing')} or ${table.ownerOrganizationId} is not null`,
    ),
    nonEmpty('lobbies_name_nonempty', table.name),
    nonEmpty('lobbies_handle_nonempty', table.handle),
    versionPositive('lobbies', table.version),
    versionPositive('lobbies_settings', table.settingsVersion),
  ],
);

/**
 * The schedule extension of a tournament lobby, one to one. It holds only
 * schedule state: the status and the SHA3-256 of the tournament's link.
 * Owner, name, handle and version are the lobby's; every choice is a
 * setting. The competition tables reference this row, so the foreign key
 * itself proves their lobby is a tournament.
 */
export const tournaments = pgTable(
  'tournaments',
  {
    lobbyId: text('lobby_id').primaryKey(),
    lobbyKind: constantText('lobby_kind', 'tournament'),
    status: text('status')
      .$type<(typeof tournamentStatuses)[number]>()
      .notNull()
      .default('draft'),
    linkHash: text('link_hash'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('tournaments_lobby_kind_idx').on(table.lobbyId, table.lobbyKind),
    foreignKey({
      name: 'tournaments_tournament_lobby_fk',
      columns: [table.lobbyId, table.lobbyKind],
      foreignColumns: [lobbies.id, lobbies.kind],
    }).onDelete('restrict'),
    check('tournaments_status_check', oneOf(table.status, tournamentStatuses)),
    check(
      'tournaments_link_hash_check',
      sql`${table.linkHash} is null or ${table.linkHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
