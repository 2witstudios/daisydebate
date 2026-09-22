import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username'),
    email: text('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name').notNull().default(''),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    version: integer('version').notNull().default(1),
    /**
     * Tombstone (ADR 0029): account deletion scrubs PII and sets this instead
     * of deleting the row, so competitive history keeps its actor. The CHECK
     * makes a tombstone with PII unrepresentable.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    uniqueIndex('users_username_lower_unique').on(
      sql`lower(${table.username})`,
    ),
    check(
      'users_tombstone_scrubbed',
      sql`${table.deletedAt} is null or (${table.email} is null and ${table.username} is null and ${table.image} is null and ${table.name} = '')`,
    ),
  ],
);
