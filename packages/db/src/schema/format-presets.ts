import { roomConfigSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { jsonbColumn, jsonbIsObject, timestampColumn } from './columns';
import { formatRevisions } from './format-revisions';

/**
 * Sanctioned RoomConfig values for rated play, as immutable revisions
 * (ADR 0058 §3). A ranked round resolves from the current revision for its
 * format (every Round is full length, DEC-237); every earlier revision is
 * retained, because a live
 * round pins the exact one that produced its rules. `format_version` names
 * the definition revision the config was approved against, so a changed
 * definition cannot silently stale an approved preset — drift fails at
 * approval, when the config is resolved against the pinned definition.
 */
export const formatPresets = pgTable(
  'format_presets',
  {
    formatId: text('format_id').notNull(),
    version: integer('version').notNull(),
    formatVersion: integer('format_version').notNull(),
    config: jsonbColumn('config', roomConfigSchema).notNull(),
    approvedAt: timestampColumn('approved_at').notNull(),
    supersededAt: timestampColumn('superseded_at'),
  },
  (table) => [
    primaryKey({ columns: [table.formatId, table.version] }),
    // The quad a round's provenance FK targets (ADR 0058 §2a).
    uniqueIndex('format_presets_provenance_unique').on(
      table.formatId,
      table.version,
      table.formatVersion,
    ),
    // At most one current revision per format; earlier ones stay.
    uniqueIndex('format_presets_single_current')
      .on(table.formatId)
      .where(sql`${table.supersededAt} is null`),
    index('format_presets_revision_idx').on(
      table.formatId,
      table.formatVersion,
    ),
    foreignKey({
      name: 'format_presets_revision_fk',
      columns: [table.formatId, table.formatVersion],
      foreignColumns: [formatRevisions.formatId, formatRevisions.version],
    }),
    check('format_presets_version_positive', sql`${table.version} > 0`),
    check(
      'format_presets_format_version_positive',
      sql`${table.formatVersion} > 0`,
    ),
    jsonbIsObject('format_presets', table.config),
  ],
);
