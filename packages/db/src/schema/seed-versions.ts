import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const seedVersions = pgTable('seed_versions', {
  seedName: text('seed_name').primaryKey(),
  version: text('version').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});
