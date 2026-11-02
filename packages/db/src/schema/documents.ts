import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAtColumn, updatedAtColumn } from './columns';
import { actors } from './actors';

/**
 * A member's prep document (ADR 0054, ADR 0058 §9): normalized HTML, the
 * stored source of truth, owned by one actor with no round FK — the
 * ownership direction cannot be inverted. A Round only opens its
 * participants' documents, so ending or deleting one never touches them.
 * `revision` is the optimistic compare-and-swap counter
 * every save checks and bumps.
 */
export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    ownerActorId: text('owner_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    html: text('html').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('documents_owner_created_idx').on(
      table.ownerActorId,
      table.createdAt,
    ),
    check(
      'documents_title_length',
      sql`char_length(${table.title}) between 1 and 120`,
    ),
    check('documents_revision_positive', sql`${table.revision} > 0`),
  ],
);
