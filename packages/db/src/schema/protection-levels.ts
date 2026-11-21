import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { protectionLevelSchema } from '@daisy/protocol/protection-level';
import { jsonbColumn, jsonbIsObject } from './columns';
import { users } from './users';

export const protectionLevels = pgTable(
  'protection_levels',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),
    choice: jsonbColumn('choice', protectionLevelSchema).notNull(),
  },
  (table) => [
    jsonbIsObject('protection_levels', table.choice),
    check(
      'protection_levels_choice',
      sql`case when ${table.choice}->>'level' = 'custom' then
        (${table.choice}->>'friendApproval' in ('none', 'inbound-adult', 'all')
          and jsonb_typeof(${table.choice}->'friendsOnlyMessages') = 'boolean'
          and jsonb_typeof(${table.choice}->'rankedAllowed') = 'boolean'
          and ${table.choice} - array['level','friendApproval','friendsOnlyMessages','rankedAllowed'] = '{}'::jsonb) is true
        else ${table.choice} in ('{"level":"independent"}'::jsonb,
          '{"level":"guided"}'::jsonb, '{"level":"supervised"}'::jsonb) end`,
    ),
  ],
);
