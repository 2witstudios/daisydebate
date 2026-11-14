import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  jsonObjectSchema,
  updatedAtColumn,
} from './columns';
import { lobbies } from './lobbies';
import { organizations } from './organizations';
import { nonEmpty, oneTenantKey } from './tenant-keys';

/**
 * The typed settings of a ballot: identity plus a pointer to the current
 * version, owned by exactly one organization or lobby. It mirrors `formats`
 * and `format_revisions`: publishing a version appends and moves the
 * pointer, so a template, event, Room or ballot pinning an older version
 * still resolves. The pointer's foreign key is DEFERRABLE INITIALLY DEFERRED
 * in the committed SQL, because the pointer and the first version commit
 * together.
 */
export const ballotDefinitions = pgTable(
  'ballot_definitions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'restrict',
    }),
    lobbyId: text('lobby_id').references(() => lobbies.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    currentVersion: integer('current_version').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  // Annotated: the two tables reference each other, which TypeScript cannot infer.
  (table): PgTableExtraConfigValue[] => [
    unique('ballot_definitions_id_organization_unique').on(
      table.id,
      table.organizationId,
    ),
    unique('ballot_definitions_id_lobby_unique').on(table.id, table.lobbyId),
    index('ballot_definitions_organization_idx').on(table.organizationId),
    index('ballot_definitions_lobby_idx').on(table.lobbyId),
    index('ballot_definitions_current_version_idx').on(
      table.id,
      table.currentVersion,
    ),
    foreignKey({
      name: 'ballot_definitions_current_version_fk',
      columns: [table.id, table.currentVersion],
      foreignColumns: [
        ballotDefinitionVersions.ballotDefinitionId,
        ballotDefinitionVersions.version,
      ],
    }),
    oneTenantKey('ballot_definitions', table.organizationId, table.lobbyId),
    check(
      'ballot_definitions_current_version_positive',
      sql`${table.currentVersion} > 0`,
    ),
    nonEmpty('ballot_definitions_name_nonempty', table.name),
  ],
);

/** One immutable version of a ballot definition, written once. */
export const ballotDefinitionVersions = pgTable(
  'ballot_definition_versions',
  {
    ballotDefinitionId: text('ballot_definition_id').notNull(),
    version: integer('version').notNull(),
    organizationId: text('organization_id'),
    lobbyId: text('lobby_id'),
    /** Its contract is the ballot definition schema, which slice F owns. */
    definition: jsonbColumn('definition', jsonObjectSchema).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.ballotDefinitionId, table.version] }),
    index('ballot_definition_versions_organization_idx').on(
      table.ballotDefinitionId,
      table.organizationId,
    ),
    index('ballot_definition_versions_lobby_idx').on(
      table.ballotDefinitionId,
      table.lobbyId,
    ),
    foreignKey({
      name: 'ballot_definition_versions_organization_fk',
      columns: [table.ballotDefinitionId, table.organizationId],
      foreignColumns: [ballotDefinitions.id, ballotDefinitions.organizationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ballot_definition_versions_lobby_fk',
      columns: [table.ballotDefinitionId, table.lobbyId],
      foreignColumns: [ballotDefinitions.id, ballotDefinitions.lobbyId],
    }).onDelete('restrict'),
    oneTenantKey(
      'ballot_definition_versions',
      table.organizationId,
      table.lobbyId,
    ),
    check(
      'ballot_definition_versions_version_positive',
      sql`${table.version} > 0`,
    ),
    jsonbIsObject('ballot_definition_versions', table.definition),
  ],
);
