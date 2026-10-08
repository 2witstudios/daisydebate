import { formatDefinitionSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { createdAtColumn, jsonbColumn, jsonbIsObject } from './columns';

/**
 * Immutable FormatDefinition history (ADR 0058 §2a). A row is written once
 * when a revision is published and never updated, so a preset or a round
 * pinning `format_version` can re-read the exact definition that produced
 * its rules, however far the format has moved on.
 */
export const formatRevisions = pgTable(
  'format_revisions',
  {
    formatId: text('format_id').notNull(),
    version: integer('version').notNull(),
    definition: jsonbColumn('definition', formatDefinitionSchema).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.formatId, table.version] }),
    jsonbIsObject('format_revisions', table.definition),
    check('format_revisions_version_positive', sql`${table.version} > 0`),
  ],
);
