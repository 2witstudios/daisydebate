import type { FormatRules } from '@daisy/protocol';
import { boolean, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';

/**
 * Debate formats. `id` is the slug (`'foundation'`); `rules` is validated by
 * the protocol `formatRulesSchema` before every write, and its `seats` map is
 * exhaustive over `debateRoles`.
 */
export const formats = pgTable(
  'formats',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    rules: jsonb('rules').$type<FormatRules>().notNull(),
    rankedEligible: boolean('ranked_eligible').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [versionPositive('formats', table.version)],
);
