import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { debateDocuments } from './schema/debate-documents';
import { instrumented, type DatabaseEventSink } from './instrumented';
import type {
  DebateDocumentRecord,
  DebateDocumentSave,
  NewDebateDocument,
} from './debate-document-record';

type Row = typeof debateDocuments.$inferSelect;

const toRecord = (row: Row): DebateDocumentRecord => ({
  id: row.id,
  ownerUserId: row.ownerUserId,
  aiDebateId: row.aiDebateId,
  folder: row.folder === 'round' ? 'round' : 'library',
  templateId: row.templateId,
  title: row.title,
  html: row.html,
  revision: row.revision,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * The round-room document area (ADR 0054): plain record adapters. Every
 * read and write names the owner, so a document is never reached through
 * another user. Saves are an optimistic compare-and-swap on `revision`: a
 * stale save writes nothing and reports the current revision.
 */
export const debateDocumentOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async createDebateDocument(
    document: NewDebateDocument,
  ): Promise<DebateDocumentRecord> {
    return instrumented(eventSink, 'createDebateDocument', async () => {
      const [row] = await database
        .insert(debateDocuments)
        .values({ ...document, revision: 1, updatedAt: document.createdAt })
        .returning();
      if (!row) throw new Error('Document insert returned no row');
      return toRecord(row);
    });
  },

  /** The owner's round documents for one AI debate, then all their library. */
  async listDebateDocuments({
    ownerUserId,
    aiDebateId,
  }: {
    readonly ownerUserId: string;
    readonly aiDebateId: string;
  }): Promise<DebateDocumentRecord[]> {
    return instrumented(eventSink, 'listDebateDocuments', async () => {
      const rows = await database
        .select()
        .from(debateDocuments)
        .where(
          and(
            eq(debateDocuments.ownerUserId, ownerUserId),
            or(
              eq(debateDocuments.aiDebateId, aiDebateId),
              eq(debateDocuments.folder, 'library'),
            ),
          ),
        )
        .orderBy(asc(debateDocuments.createdAt), asc(debateDocuments.title));
      return rows.map(toRecord);
    });
  },

  async saveDebateDocument({
    id,
    ownerUserId,
    html,
    expectedRevision,
    updatedAt,
  }: {
    readonly id: string;
    readonly ownerUserId: string;
    readonly html: string;
    readonly expectedRevision: number;
    readonly updatedAt: Date;
  }): Promise<DebateDocumentSave> {
    return instrumented(eventSink, 'saveDebateDocument', async () => {
      const owned = and(
        eq(debateDocuments.id, id),
        eq(debateDocuments.ownerUserId, ownerUserId),
      );
      const [saved] = await database
        .update(debateDocuments)
        .set({
          html,
          updatedAt,
          revision: sql`${debateDocuments.revision} + 1`,
        })
        .where(and(owned, eq(debateDocuments.revision, expectedRevision)))
        .returning({ revision: debateDocuments.revision });
      if (saved) return { status: 'saved', revision: saved.revision };
      const [current] = await database
        .select({ revision: debateDocuments.revision })
        .from(debateDocuments)
        .where(owned)
        .limit(1);
      return current
        ? { status: 'conflict', revision: current.revision }
        : { status: 'missing' };
    });
  },

  /** Renames without touching `revision`, so an open editor keeps saving. */
  async renameDebateDocument({
    id,
    ownerUserId,
    title,
    updatedAt,
  }: {
    readonly id: string;
    readonly ownerUserId: string;
    readonly title: string;
    readonly updatedAt: Date;
  }): Promise<DebateDocumentRecord | null> {
    return instrumented(eventSink, 'renameDebateDocument', async () => {
      const [row] = await database
        .update(debateDocuments)
        .set({ title, updatedAt })
        .where(
          and(
            eq(debateDocuments.id, id),
            eq(debateDocuments.ownerUserId, ownerUserId),
          ),
        )
        .returning();
      return row ? toRecord(row) : null;
    });
  },
});
