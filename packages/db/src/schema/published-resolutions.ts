import { sql } from 'drizzle-orm';
import { check, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';

/** Published wording is immutable; replacement retires one record and adds another. */
export const publishedResolutions = pgTable(
  'published_resolutions',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<'policy' | 'value'>().notNull(),
    text: text('text').notNull(),
    provenance: text('provenance').notNull(),
    publishedAt: timestampColumn('published_at').notNull().defaultNow(),
    retiredAt: timestampColumn('retired_at'),
  },
  (table) => [
    check(
      'published_resolutions_kind_check',
      oneOf(table.kind, ['policy', 'value']),
    ),
    check(
      'published_resolutions_text_check',
      sql`length(trim(${table.text})) between 1 and 300`,
    ),
    check(
      'published_resolutions_provenance_check',
      sql`length(trim(${table.provenance})) > 0`,
    ),
    check(
      'published_resolutions_retirement_check',
      sql`${table.retiredAt} is null or ${table.retiredAt} >= ${table.publishedAt}`,
    ),
    uniqueIndex('published_resolutions_current_kind')
      .on(table.kind)
      .where(sql`${table.retiredAt} is null`),
  ],
);
