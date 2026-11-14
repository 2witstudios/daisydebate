import {
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ballotDefinitionVersions } from './ballot-definitions';
import {
  createdAtColumn,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { formatRevisions } from './format-revisions';
import { lobbies } from './lobbies';
import { organizations } from './organizations';
import { bothOrNeither, constantText, nonEmpty } from './tenant-keys';

/**
 * An organization's reusable definition of one kind of event or lobby Room:
 * a pinned format, a pinned ballot definition (null is the Daisy ballot) and
 * settings at template scope. The pins never change, by trigger: a different
 * format or ballot is a new template. Only the name and `retired_at` are
 * edited. A retired template takes no new follow, offer or copy.
 */
export const templates = pgTable(
  'templates',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    formatId: text('format_id').notNull(),
    formatVersion: integer('format_version').notNull(),
    ballotDefinitionId: text('ballot_definition_id'),
    ballotDefinitionVersion: integer('ballot_definition_version'),
    retiredAt: timestampColumn('retired_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
    settingsVersion: integer('settings_version').notNull().default(1),
  },
  (table) => [
    unique('templates_id_organization_unique').on(
      table.id,
      table.organizationId,
    ),
    unique('templates_id_format_unique').on(
      table.id,
      table.formatId,
      table.formatVersion,
    ),
    uniqueIndex('templates_name_unique').on(
      table.organizationId,
      sql`lower(${table.name})`,
    ),
    index('templates_format_revision_idx').on(
      table.formatId,
      table.formatVersion,
    ),
    index('templates_ballot_definition_idx').on(
      table.ballotDefinitionId,
      table.ballotDefinitionVersion,
    ),
    foreignKey({
      name: 'templates_format_revision_fk',
      columns: [table.formatId, table.formatVersion],
      foreignColumns: [formatRevisions.formatId, formatRevisions.version],
    }).onDelete('restrict'),
    foreignKey({
      name: 'templates_ballot_definition_fk',
      columns: [table.ballotDefinitionId, table.ballotDefinitionVersion],
      foreignColumns: [
        ballotDefinitionVersions.ballotDefinitionId,
        ballotDefinitionVersions.version,
      ],
    }).onDelete('restrict'),
    bothOrNeither(
      'templates_ballot_definition_complete',
      table.ballotDefinitionId,
      table.ballotDefinitionVersion,
    ),
    nonEmpty('templates_name_nonempty', table.name),
    versionPositive('templates', table.version),
    versionPositive('templates_settings', table.settingsVersion),
  ],
);

/**
 * The templates a standing lobby offers; a tournament lobby cannot offer
 * one. The template may belong to any organization, so a league's lobby can
 * offer Daisy's. A row is withdrawn, never deleted, because Rooms reference
 * it.
 */
export const lobbyTemplates = pgTable(
  'lobby_templates',
  {
    lobbyId: text('lobby_id').notNull(),
    lobbyKind: constantText('lobby_kind', 'standing'),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'restrict' }),
    withdrawnAt: timestampColumn('withdrawn_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.lobbyId, table.templateId] }),
    index('lobby_templates_lobby_kind_idx').on(table.lobbyId, table.lobbyKind),
    index('lobby_templates_template_idx').on(table.templateId),
    foreignKey({
      name: 'lobby_templates_standing_lobby_fk',
      columns: [table.lobbyId, table.lobbyKind],
      foreignColumns: [lobbies.id, lobbies.kind],
    }).onDelete('restrict'),
  ],
);
