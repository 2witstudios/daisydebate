import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
export const debates = pgTable(
  'debates',
  {
    id: uuid('id').primaryKey(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    resolution: text('resolution').notNull(),
    format: text('format').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('debates_created_by_idx').on(table.createdBy),
    check('debates_version_positive', sql`${table.version} > 0`),
  ],
);
