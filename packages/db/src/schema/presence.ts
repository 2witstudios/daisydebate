import { boolean, pgTable } from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { contactActorColumn } from './contacts';

/**
 * A member's choice to hide their online status from friends (ADR 0072).
 * No row means visible; a hidden member shows offline to every friend.
 */
export const presenceSettings = pgTable('presence_settings', {
  actorId: contactActorColumn('actor_id').primaryKey(),
  hidden: boolean('hidden').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
