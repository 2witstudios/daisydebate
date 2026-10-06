import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { aiDebates } from './ai-debates';
import { createdAtColumn, oneOf, updatedAtColumn } from './columns';
import { users } from './users';

/** Where a document lives: one round's folder, or the debater's library. */
export const debateDocumentFolders = ['round', 'library'] as const;

/**
 * A debater's round-room document (ADR 0054): normalized HTML, the stored
 * source of truth, owned by one user. A round document belongs to one AI
 * debate; a library document to none. `revision` is the optimistic
 * compare-and-swap counter every save checks and bumps.
 */
export const debateDocuments = pgTable(
  'debate_documents',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    aiDebateId: text('ai_debate_id').references(() => aiDebates.id, {
      onDelete: 'cascade',
    }),
    folder: text('folder').notNull(),
    templateId: text('template_id').notNull(),
    title: text('title').notNull(),
    html: text('html').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('debate_documents_owner_ai_debate_idx').on(
      table.ownerUserId,
      table.aiDebateId,
    ),
    index('debate_documents_owner_folder_idx').on(
      table.ownerUserId,
      table.folder,
    ),
    index('debate_documents_ai_debate_idx').on(table.aiDebateId),
    check(
      'debate_documents_folder_check',
      oneOf(table.folder, debateDocumentFolders),
    ),
    check(
      'debate_documents_round_has_debate',
      sql`(${table.folder} = 'round') = (${table.aiDebateId} is not null)`,
    ),
    check(
      'debate_documents_title_length',
      sql`char_length(${table.title}) between 1 and 120`,
    ),
    check('debate_documents_revision_positive', sql`${table.revision} > 0`),
  ],
);
