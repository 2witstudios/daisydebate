import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, updatedAtColumn } from './columns';
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
    currentVersion: integer('current_version').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('formats_current_revision_idx').on(table.id, table.currentVersion),
    foreignKey({
      name: 'formats_current_revision_fk',
      columns: [table.id, table.currentVersion],
      foreignColumns: [formatRevisions.formatId, formatRevisions.version],
    }),
    check('formats_current_version_positive', sql`${table.currentVersion} > 0`),
  ],
);
