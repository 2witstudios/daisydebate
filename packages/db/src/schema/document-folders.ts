import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import { createdAtColumn, updatedAtColumn } from './columns';

/**
 * A folder in one member's drive (ADR 0111). A null parent is the drive's root.
 * The self key carries the owner, so a folder can never sit under another
 * member's folder and never outlives its parent. Postgres cannot state "no
 * cycle" as a constraint, so a trigger in the migration refuses one; moves also
 * run one at a time under the account fence.
 */
export const documentFolders = pgTable(
  'document_folders',
  {
    id: text('id').primaryKey(),
    ownerActorId: text('owner_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    parentFolderId: text('parent_folder_id'),
    name: text('name').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('document_folders_owner_id_unique').on(table.ownerActorId, table.id),
    foreignKey({
      name: 'document_folders_parent_fk',
      columns: [table.ownerActorId, table.parentFolderId],
      foreignColumns: [table.ownerActorId, table.id],
    }).onDelete('cascade'),
    index('document_folders_listing_idx').on(
      table.ownerActorId,
      table.parentFolderId,
      table.name,
      table.id,
    ),
    check(
      'document_folders_name_length',
      sql`char_length(${table.name}) between 1 and 120`,
    ),
    check(
      'document_folders_not_own_parent',
      sql`${table.parentFolderId} is distinct from ${table.id}`,
    ),
  ],
);
