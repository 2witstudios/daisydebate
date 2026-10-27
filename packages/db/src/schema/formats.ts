import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import {
  catalogFamilies,
  catalogRoles,
  standardFormatIds,
} from '../catalog-formats';
import { createdAtColumn, oneOf, updatedAtColumn } from './columns';
import { actors } from './actors';
import { formatRevisions } from './format-revisions';

/**
 * Debate formats: identity plus a pointer to the current definition
 * revision (ADR 0058 §2a). Reference rows ship in the baseline and forward
 * migrations, never in the dev seed (ADR 0038). A definition is never
 * rewritten in place: publishing a revision appends to `format_revisions`
 * and moves the pointer, so a preset or round pinning an older
 * `format_version` still resolves. The pointer's composite FK to
 * `format_revisions` is DEFERRABLE INITIALLY DEFERRED in the committed
 * baseline SQL — drizzle-kit cannot express it, and the pointer and the
 * first revision must commit together.
 */
export const formats = pgTable(
  'formats',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** Null only for publisher-owned catalog entries; custom room formats stay private. */
    createdByActorId: text('created_by_actor_id').references(() => actors.id, {
      onDelete: 'restrict',
    }),
    currentVersion: integer('current_version').notNull(),
    /**
     * Whether the picker offers it (FMT-1): a Daisy standard, a league
     * template, or null for formats it never lists — private custom
     * formats, One-on-one (ranked and history) and Foundation. Ranked
     * admission does not read it.
     */
    catalogRole: text('catalog_role').$type<(typeof catalogRoles)[number]>(),
    /** The league browser tab; set exactly for templates. */
    family: text('family').$type<(typeof catalogFamilies)[number]>(),
    /** Governing bodies whose rules a template follows: display labels, never tenants. */
    leagues: text('leagues')
      .array()
      .notNull()
      .default(sql`'{}'`),
    searchTerms: text('search_terms').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('formats_created_by_actor_idx').on(table.createdByActorId),
    index('formats_current_revision_idx').on(table.id, table.currentVersion),
    foreignKey({
      name: 'formats_current_revision_fk',
      columns: [table.id, table.currentVersion],
      foreignColumns: [formatRevisions.formatId, formatRevisions.version],
    }),
    check('formats_current_version_positive', sql`${table.currentVersion} > 0`),
    // Null-safe: a CHECK passes on NULL, so each rule spells its NULL case.
    check(
      'formats_catalog_role_check',
      sql`${table.catalogRole} is null or ${oneOf(table.catalogRole, catalogRoles)}`,
    ),
    check(
      'formats_catalog_is_publisher_owned',
      sql`${table.catalogRole} is null or ${table.createdByActorId} is null`,
    ),
    check(
      'formats_standard_ids',
      sql`${table.catalogRole} is distinct from 'standard' or ${oneOf(table.id, standardFormatIds)}`,
    ),
    check(
      'formats_family_for_templates',
      sql`(${table.family} is not null) = coalesce(${table.catalogRole} = 'template', false)`,
    ),
    check(
      'formats_family_check',
      sql`${table.family} is null or ${oneOf(table.family, catalogFamilies)}`,
    ),
  ],
);
