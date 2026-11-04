import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, updatedAtColumn } from './columns';
import { actors } from './actors';
import { documentFolders } from './document-folders';

const searchVector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

/**
 * A member's document (ADR 0054, ADR 0058 §9, ADR 0111): normalized HTML, the
 * stored source of truth, owned by one actor with no round FK. A Round only
 * opens its participants' documents, so ending or deleting one never touches
 * them. A null folder is the drive's root; the folder key carries the owner, so
 * a document can never sit in another member's folder, and deleting a folder
 * deletes what is in it. `revision` is the optimistic compare-and-swap counter
 * every save checks and bumps. `search` uses the `simple` config: debaters need
 * exact words and names back, in any language, and the parser drops HTML tags.
 */
export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    ownerActorId: text('owner_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    folderId: text('folder_id'),
    title: text('title').notNull(),
    html: text('html').notNull(),
    revision: integer('revision').notNull().default(1),
    search: searchVector('search')
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('simple'::regconfig, title), 'A') || setweight(to_tsvector('simple'::regconfig, html), 'B')`,
      ),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({
      name: 'documents_folder_fk',
      columns: [table.ownerActorId, table.folderId],
      foreignColumns: [documentFolders.ownerActorId, documentFolders.id],
    }).onDelete('cascade'),
    index('documents_listing_idx').on(
      table.ownerActorId,
      table.folderId,
      table.title,
      table.id,
    ),
    index('documents_owner_edited_idx').on(
      table.ownerActorId,
      table.updatedAt,
    ),
    index('documents_search_idx').using('gin', table.search),
    check(
      'documents_title_length',
      sql`char_length(${table.title}) between 1 and 120`,
    ),
    check('documents_revision_positive', sql`${table.revision} > 0`),
  ],
);
