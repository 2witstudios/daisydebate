import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { documents } from './schema/documents';

export type DocumentRecord = {
  readonly id: string;
  readonly ownerActorId: string;
  readonly title: string;
  readonly html: string;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type DocumentSave =
  | { readonly status: 'saved'; readonly revision: number }
  | { readonly status: 'conflict'; readonly revision: number }
  | { readonly status: 'missing' };

const documentColumns = {
  id: documents.id,
  ownerActorId: documents.ownerActorId,
  title: documents.title,
  html: documents.html,
  revision: documents.revision,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

const toDocumentRecord = (
  row: typeof documents.$inferSelect,
): DocumentRecord => ({
  id: row.id,
  ownerActorId: row.ownerActorId,
  title: row.title,
  html: row.html,
  revision: row.revision,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** A swapped row saved; otherwise a present document conflicts, an absent one is missing. */
export const documentSaveOutcome = (
  updated: readonly { readonly revision: number }[],
  current: { readonly revision: number } | undefined,
): DocumentSave =>
  updated.length === 1
    ? { status: 'saved', revision: updated[0]!.revision }
    : current
      ? { status: 'conflict', revision: current.revision }
      : { status: 'missing' };

/**
 * The member's prep documents (ADR 0054, ADR 0058 §9): owned by an actor,
 * with no round FK — the round's workspace is a view over what the owner
 * can read. A save is a revision
 * compare-and-swap; a rename never touches the revision, so an open
 * editor keeps saving.
 */
export const documentOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async createDocument(input: {
    readonly id: string;
    readonly ownerActorId: string;
    readonly title: string;
    readonly html: string;
  }): Promise<DocumentRecord> {
    return instrumented(eventSink, 'createDocument', async () => {
      const [row] = await database
        .insert(documents)
        .values({
          id: input.id,
          ownerActorId: input.ownerActorId,
          title: input.title,
          html: input.html,
        })
        .returning();
      if (!row) throw new Error('Document insert returned no row');
      return toDocumentRecord(row);
    });
  },

  /** Only the reader's own documents, ordered by title. */
  async listDocuments(input: {
    readonly ownerActorId: string;
  }): Promise<readonly DocumentRecord[]> {
    return instrumented(eventSink, 'listDocuments', async () =>
      database
        .select(documentColumns)
        .from(documents)
        .where(eq(documents.ownerActorId, input.ownerActorId))
        .orderBy(documents.title),
    );
  },

  async saveDocument(input: {
    readonly id: string;
    readonly ownerActorId: string;
    readonly html: string;
    readonly expectedRevision: number;
  }): Promise<DocumentSave> {
    return instrumented(eventSink, 'saveDocument', async () => {
      const updated = await database
        .update(documents)
        .set({
          html: input.html,
          revision: sql`${documents.revision} + 1`,
          updatedAt: sql`statement_timestamp()` as unknown as Date,
        })
        .where(
          and(
            eq(documents.id, input.id),
            eq(documents.ownerActorId, input.ownerActorId),
            eq(documents.revision, input.expectedRevision),
          ),
        )
        .returning({ revision: documents.revision });
      if (updated.length === 1) return documentSaveOutcome(updated, undefined);
      const [row] = await database
        .select({ revision: documents.revision })
        .from(documents)
        .where(
          and(
            eq(documents.id, input.id),
            eq(documents.ownerActorId, input.ownerActorId),
          ),
        )
        .limit(1);
      return documentSaveOutcome(updated, row);
    });
  },

  async renameDocument(input: {
    readonly id: string;
    readonly ownerActorId: string;
    readonly title: string;
  }): Promise<DocumentRecord | null> {
    return instrumented(eventSink, 'renameDocument', async () => {
      const [row] = await database
        .update(documents)
        .set({
          title: input.title,
          updatedAt: sql`statement_timestamp()` as unknown as Date,
        })
        .where(
          and(
            eq(documents.id, input.id),
            eq(documents.ownerActorId, input.ownerActorId),
          ),
        )
        .returning();
      return row ? toDocumentRecord(row) : null;
    });
  },
});
