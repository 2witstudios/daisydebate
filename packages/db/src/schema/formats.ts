import type { FormatRules } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text } from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';

/**
 * Debate formats. `id` is the slug (`'foundation'`). Writers (the seed today,
 * adapters later) validate `rules` with the protocol `formatRulesSchema`,
 * whose `seats` map is exhaustive over `debateRoles`; the database keeps the
 * version-1 shape (`version`, `seats`, `clock`) as a floor.
 */
export const formats = pgTable(
  'formats',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    rules: jsonbColumn('rules').$type<FormatRules>().notNull(),
    rankedEligible: boolean('ranked_eligible').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    check(
      'formats_rules_shape',
      // coalesce: a missing key yields NULL, and a NULL CHECK passes.
      sql`coalesce(${table.rules}->>'version', '') = '1' and coalesce(jsonb_typeof(${table.rules}->'seats'), '') = 'object' and coalesce(jsonb_typeof(${table.rules}->'clock'), '') = 'object'`,
    ),
    versionPositive('formats', table.version),
  ],
);
