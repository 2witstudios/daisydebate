import { sanctionStatuses, seasonCountings } from '@daisy/protocol/lobby';
import { sql } from 'drizzle-orm';
import {
  boolean,
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
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { events } from './events';
import { organizations } from './organizations';
import { seasons } from './ratings';
import { templates } from './templates';
import { constantText } from './tenant-keys';

/**
 * A league's yes to an event, which makes the event's certified results
 * count toward one of the league's seasons. It names the league's own
 * template and season. Several leagues may sanction one event, each once.
 * Nothing about the match is stored: whether the event meets what the
 * template enforces is computed when the league answers. The row carries
 * the league's key on a lobby's event and grants the league nothing there:
 * it is never a grant scope.
 */
export const sanctions = pgTable(
  'sanctions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    organizationKind: constantText('organization_kind', 'league'),
    lobbyId: text('lobby_id').notNull(),
    eventId: text('event_id').notNull(),
    seasonId: text('season_id').notNull(),
    templateId: text('template_id').notNull(),
    status: text('status').$type<(typeof sanctionStatuses)[number]>().notNull(),
    decidedAt: timestampColumn('decided_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('sanctions_once_per_league').on(table.organizationId, table.eventId),
    index('sanctions_league_idx').on(
      table.organizationId,
      table.organizationKind,
    ),
    index('sanctions_event_idx').on(table.eventId, table.lobbyId),
    index('sanctions_season_idx').on(table.seasonId, table.organizationId),
    index('sanctions_template_idx').on(table.templateId, table.organizationId),
    foreignKey({
      name: 'sanctions_league_fk',
      columns: [table.organizationId, table.organizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sanctions_event_fk',
      columns: [table.eventId, table.lobbyId],
      foreignColumns: [events.id, events.lobbyId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sanctions_season_fk',
      columns: [table.seasonId, table.organizationId],
      foreignColumns: [seasons.id, seasons.organizationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sanctions_template_fk',
      columns: [table.templateId, table.organizationId],
      foreignColumns: [templates.id, templates.organizationId],
    }).onDelete('restrict'),
    check('sanctions_status_check', oneOf(table.status, sanctionStatuses)),
    check(
      'sanctions_decided_consistent',
      sql`case when ${table.status} = 'requested' then ${table.decidedAt} is null
        when ${table.status} in ('approved', 'declined') then ${table.decidedAt} is not null
        else true end`,
    ),
    versionPositive('sanctions', table.version),
  ],
);

/**
 * How a league's season counts: by sanction or by membership, whether its
 * lobby's Rooms count, and the league's rule. With approved sanctions and
 * `certification_results` these are the inputs of a season fold; nothing
 * computed is stored.
 */
export const seasonStandingRules = pgTable(
  'season_standing_rules',
  {
    seasonId: text('season_id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    counting: text('counting').$type<(typeof seasonCountings)[number]>().notNull(),
    countsLobbyRooms: boolean('counts_lobby_rooms').notNull().default(false),
    /** Its contract is the season fold's rule, which slice G owns. */
    rule: jsonbColumn('rule', jsonObjectSchema).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    index('season_standing_rules_season_idx').on(
      table.seasonId,
      table.organizationId,
    ),
    foreignKey({
      name: 'season_standing_rules_season_fk',
      columns: [table.seasonId, table.organizationId],
      foreignColumns: [seasons.id, seasons.organizationId],
    }).onDelete('cascade'),
    check(
      'season_standing_rules_counting_check',
      oneOf(table.counting, seasonCountings),
    ),
    jsonbIsObject('season_standing_rules', table.rule),
    versionPositive('season_standing_rules', table.version),
  ],
);
