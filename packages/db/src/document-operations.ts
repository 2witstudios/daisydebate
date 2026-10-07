import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { documents, roundDocumentRefs } from './schema/documents';

export type DocumentRecord = {
  readonly id: string;
  readonly ownerActorId: string;
  readonly title: string;
  readonly html: string;
  readonly templateId: string;
  readonly folder: string;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type DocumentSave =
  | { readonly status: 'saved'; readonly revision: number }
  | { readonly status: 'conflict'; readonly revision: number }
  | { readonly status: 'missing' };

const documentColumns = {
  id: documents.id,
  ownerActorId: documents.ownerActorId,
  title: documents.title,
  html: documents.html,
  templateId: documents.templateId,
  folder: documents.folder,
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
  templateId: row.templateId,
  folder: row.folder,
  revision: row.revision,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * The member's prep documents (ADR 0054, ADR 0058 §9): owned by an actor,
 * with no round FK — the round's workspace is a view over what the owner
 * can read, carried by `round_document_refs`. A save is a revision
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
    readonly templateId: string;
    readonly folder: 'library' | 'scratch';
  }): Promise<DocumentRecord> {
    return instrumented(eventSink, 'createDocument', async () => {
      const [row] = await database
        .insert(documents)
        .values({
          id: input.id,
          ownerActorId: input.ownerActorId,
          title: input.title,
          html: input.html,
          templateId: input.templateId,
          folder: input.folder,
        })
        .returning();
      if (!row) throw new Error('Document insert returned no row');
      return toDocumentRecord(row);
    });
  },

  /**
   * What a round's workspace reads: the owner's own documents, plus every
   * document scoped into the round by a ref. Ordered by title.
   */
  async listDocuments(input: {
    readonly ownerActorId: string;
    readonly roundId: string | null;
  }): Promise<readonly DocumentRecord[]> {
    return instrumented(eventSink, 'listDocuments', async () => {
      const owned = await database
        .select(documentColumns)
        .from(documents)
        .where(eq(documents.ownerActorId, input.ownerActorId));
      const referenced =
        input.roundId === null
          ? []
          : await database
              .select(documentColumns)
              .from(roundDocumentRefs)
              .innerJoin(
                documents,
                eq(documents.id, roundDocumentRefs.documentId),
              )
              .where(eq(roundDocumentRefs.roundId, input.roundId));
      const byId = new Map<string, DocumentRecord>();
      for (const row of [...owned, ...referenced])
        byId.set(
          row.id,
          toDocumentRecord(row as typeof documents.$inferSelect),
        );
      return [...byId.values()].sort((a, b) =>
        a.title < b.title ? -1 : a.title > b.title ? 1 : 0,
      );
    });
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
      if (updated.length === 1)
        return { status: 'saved', revision: updated[0]!.revision };
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
      return row
        ? { status: 'conflict', revision: row.revision }
        : { status: 'missing' };
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

  /**
   * Scopes a document into one round's workspace. Scope, not existence:
   * removing the ref never touches the owned document.
   */
  async attachRoundDocument(input: {
    readonly roundId: string;
    readonly documentId: string;
    readonly role: 'flow' | 'case' | 'evidence' | 'notes';
  }): Promise<void> {
    return instrumented(eventSink, 'attachRoundDocument', async () => {
      await database
        .insert(roundDocumentRefs)
        .values({
          roundId: input.roundId,
          documentId: input.documentId,
          role: input.role,
        })
        .onConflictDoNothing();
    });
  },
});
