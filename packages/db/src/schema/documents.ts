import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  oneOf,
  timestampColumn,
  updatedAtColumn,
} from './columns';
import { actors } from './actors';
import { rounds } from './rounds';

/** Where a document lives: the owner's library, or their scratch pad. */
export const documentFolders = ['library', 'scratch'] as const;

/** The template a new document starts from. */
export const documentTemplates = [
  'blank',
  'flow',
  'cross-ex',
  'speech-plan',
  'case',
  'block',
  'evidence',
] as const;

/** The role a document plays inside one round's workspace. */
export const roundDocumentRoles = [
  'flow',
  'case',
  'evidence',
  'notes',
] as const;

/**
 * A member's prep document (ADR 0054, ADR 0058 §9): normalized HTML, the
 * stored source of truth, owned by one actor with no round FK — the
 * ownership direction cannot be inverted. Ending or deleting a Round never
 * implies deleting a Document; removing one from a round deletes only the
 * ref row below. `revision` is the optimistic compare-and-swap counter
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
    templateId: text('template_id').notNull(),
    folder: text('folder').notNull().default('library'),
    revision: integer('revision').notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('documents_owner_folder_idx').on(table.ownerActorId, table.folder),
    index('documents_owner_created_idx').on(
      table.ownerActorId,
      table.createdAt,
    ),
    check('documents_folder_check', oneOf(table.folder, documentFolders)),
    check(
      'documents_template_check',
      oneOf(table.templateId, documentTemplates),
    ),
    check(
      'documents_title_length',
      sql`char_length(${table.title}) between 1 and 120`,
    ),
    check('documents_revision_positive', sql`${table.revision} > 0`),
  ],
);

/**
 * The Round's view over what its participants can read (ADR 0058 §9):
 * scope, not existence. Removing a document from a round removes this row
 * and nothing else; `pinned_revision` is where rated-round evidence later
 * pins an immutable revision.
 */
export const roundDocumentRefs = pgTable(
  'round_document_refs',
  {
    roundId: text('round_id').notNull(),
    documentId: text('document_id').notNull(),
    role: text('role').notNull(),
    pinnedRevision: integer('pinned_revision'),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.documentId] }),
    foreignKey({
      name: 'round_document_refs_round_fk',
      columns: [table.roundId],
      foreignColumns: [rounds.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'round_document_refs_document_fk',
      columns: [table.documentId],
      foreignColumns: [documents.id],
    }).onDelete('cascade'),
    check(
      'round_document_refs_role_check',
      oneOf(table.role, roundDocumentRoles),
    ),
  ],
);
