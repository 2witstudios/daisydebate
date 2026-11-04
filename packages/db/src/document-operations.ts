import { and, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { lockAuthorizationActors } from './authorization';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { documentFolders } from './schema/document-folders';
import { documents } from './schema/documents';

export type DocumentRecord = {
  readonly id: string;
  readonly ownerActorId: string;
  readonly folderId: string | null;
  readonly title: string;
  readonly html: string;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** One row of a folder's listing: a folder or a document, never a body. */
export type DriveEntry =
  | {
      readonly kind: 'folder';
      readonly id: string;
      readonly name: string;
      readonly parentFolderId: string | null;
      readonly updatedAt: Date;
    }
  | {
      readonly kind: 'document';
      readonly id: string;
      readonly title: string;
      readonly folderId: string | null;
      readonly updatedAt: Date;
    };

/** Where a page of a listing resumes: folders sort before documents. */
export type DriveCursor = {
  readonly kind: 'folder' | 'document';
  readonly label: string;
  readonly id: string;
};

export type DocumentSearchHit = {
  readonly id: string;
  readonly title: string;
  readonly folderId: string | null;
  readonly snippet: string;
};

type DocumentSave =
  | { readonly status: 'saved'; readonly revision: number }
  | { readonly status: 'conflict'; readonly revision: number }
  | { readonly status: 'missing' };

/** Who may change a drive, decided by the caller over the freshly locked account. */
export type DriveAdmission = (
  account: Awaited<ReturnType<typeof lockAuthorizationActors>>[number],
) => boolean;

/** The most a drive holds and how deep it nests (ADR 0111). */
export const DRIVE_LIMITS = {
  documents: 2_000,
  folders: 500,
  depth: 8,
} as const;

/** One read of a folder's page, and the bodies one request may read. */
export const DRIVE_PAGE_SIZE = 100;
export const DOCUMENT_READ_MAX = 16;
export const DOCUMENT_SEARCH_PAGE = 20;

/**
 * A snippet reads only the start of a body: building one from a whole document
 * was most of a search's cost. A word further in still finds the document; its
 * snippet then shows how the document begins.
 */
const SNIPPET_SOURCE_CHARS = 8_000;

const documentColumns = {
  id: documents.id,
  ownerActorId: documents.ownerActorId,
  folderId: documents.folderId,
  title: documents.title,
  html: documents.html,
  revision: documents.revision,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

const now = () => sql`statement_timestamp()` as unknown as Date;

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

type Transaction = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];

/** The fence every drive change takes first, so moves run one at a time per member. */
const fenced = async (
  tx: Transaction,
  ownerActorId: string,
  admits: DriveAdmission,
) => {
  const [account] = await lockAuthorizationActors(tx, [ownerActorId], {
    maxActors: 1,
  });
  if (account === undefined || !admits(account))
    throw createAppError('AUTHORIZATION');
};

const ownFolder = async (
  tx: Transaction,
  ownerActorId: string,
  folderId: string | null,
) => {
  if (folderId === null) return;
  const [row] = await tx
    .select({ id: documentFolders.id })
    .from(documentFolders)
    .where(
      and(
        eq(documentFolders.id, folderId),
        eq(documentFolders.ownerActorId, ownerActorId),
      ),
    )
    .limit(1);
  if (!row) throw createAppError('NOT_FOUND');
};

const countOf = async (
  tx: Transaction,
  query: ReturnType<typeof sql>,
): Promise<number> => {
  const [row] = (await tx.execute(query)) as unknown as {
    readonly count: number | string;
  }[];
  return Number(row?.count ?? 0);
};

/** The folders above `folderId`, itself first; empty for the root. */
const ancestors = async (
  tx: Transaction,
  ownerActorId: string,
  folderId: string | null,
): Promise<readonly string[]> => {
  if (folderId === null) return [];
  const rows = (await tx.execute(sql`
    with recursive up(id, parent_folder_id, depth) as (
      select id, parent_folder_id, 1 from document_folders
      where id = ${folderId} and owner_actor_id = ${ownerActorId}
      union all
      select f.id, f.parent_folder_id, up.depth + 1
      from document_folders f join up on f.id = up.parent_folder_id
    )
    select id from up order by depth`)) as unknown as {
    readonly id: string;
  }[];
  return rows.map((row) => row.id);
};

/** How many levels a folder holds, counting itself. */
const heightOf = async (tx: Transaction, folderId: string): Promise<number> =>
  countOf(
    tx,
    sql`
    with recursive down(id, depth) as (
      select id, 1 from document_folders where id = ${folderId}
      union all
      select f.id, down.depth + 1
      from document_folders f join down on f.parent_folder_id = down.id
    )
    select max(depth) as count from down`,
  );

const driveFull = () => createAppError('CONFLICT', 'This drive is full');
const tooDeep = () => createAppError('CONFLICT', 'Folders nest too deeply');

/**
 * A member's drive (ADR 0054, ADR 0058 §9, ADR 0111): documents and folders
 * owned by an actor, with no round FK. Every call names the owner and reaches
 * only their rows. A save is a revision compare-and-swap, while a rename or move
 * never touches the revision, so an open editor keeps saving. Every change to
 * the drive's shape takes the account fence and asks `admits`, so it refuses an
 * erased or no longer admitted account; a save relies on the request's identity
 * read, and an erased account's rows are gone.
 */
export const documentOperations = ({
  database,
  searchDatabase,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  /** The search lane, so a slow search can never hold up a save (ADR 0111). */
  readonly searchDatabase: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** One page of a folder, folders first, then documents, each by name. */
  async listDriveEntries(input: {
    readonly ownerActorId: string;
    readonly folderId: string | null;
    readonly after: DriveCursor | null;
    readonly limit: number;
  }): Promise<readonly DriveEntry[]> {
    return instrumented(eventSink, 'listDriveEntries', async () => {
      const { ownerActorId, folderId, after, limit } = input;
      const rank = after?.kind === 'document' ? 1 : 0;
      const resume = after
        ? sql`where (rank, label, id) > (${rank}, ${after.label}, ${after.id})`
        : sql``;
      const rows = (await database.execute(sql`
        select * from (
          select 0 as rank, 'folder' as kind, id, name as label, updated_at
          from document_folders
          where owner_actor_id = ${ownerActorId}
            and parent_folder_id is not distinct from ${folderId}
          union all
          select 1, 'document', id, title, updated_at
          from documents
          where owner_actor_id = ${ownerActorId}
            and folder_id is not distinct from ${folderId}
        ) entries ${resume}
        order by rank, label, id
        limit ${limit}`)) as unknown as {
        readonly kind: 'folder' | 'document';
        readonly id: string;
        readonly label: string;
        readonly updated_at: Date | string;
      }[];
      return rows.map((row) =>
        row.kind === 'folder'
          ? {
              kind: 'folder',
              id: row.id,
              name: row.label,
              parentFolderId: folderId,
              updatedAt: new Date(row.updated_at),
            }
          : {
              kind: 'document',
              id: row.id,
              title: row.label,
              folderId,
              updatedAt: new Date(row.updated_at),
            },
      );
    });
  },

  /** Every folder of a drive, bounded by `DRIVE_LIMITS.folders`. */
  async listDocumentFolders(input: { readonly ownerActorId: string }): Promise<
    readonly {
      readonly id: string;
      readonly name: string;
      readonly parentFolderId: string | null;
    }[]
  > {
    return instrumented(eventSink, 'listDocumentFolders', async () =>
      database
        .select({
          id: documentFolders.id,
          name: documentFolders.name,
          parentFolderId: documentFolders.parentFolderId,
        })
        .from(documentFolders)
        .where(eq(documentFolders.ownerActorId, input.ownerActorId))
        .limit(DRIVE_LIMITS.folders),
    );
  },

  /** Only the reader's own bodies, for the documents opened or recovered. */
  async readDocuments(input: {
    readonly ownerActorId: string;
    readonly ids: readonly string[];
  }): Promise<readonly DocumentRecord[]> {
    return instrumented(eventSink, 'readDocuments', async () =>
      input.ids.length === 0
        ? []
        : database
            .select(documentColumns)
            .from(documents)
            .where(
              and(
                eq(documents.ownerActorId, input.ownerActorId),
                inArray(documents.id, [...input.ids]),
              ),
            )
            .limit(DOCUMENT_READ_MAX),
    );
  },

  /** The document edited last, so a load with nothing open lands on the work. */
  async lastEditedDocument(input: {
    readonly ownerActorId: string;
  }): Promise<string | null> {
    return instrumented(eventSink, 'lastEditedDocument', async () => {
      const [row] = await database
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.ownerActorId, input.ownerActorId))
        .orderBy(desc(documents.updatedAt), desc(documents.id))
        .limit(1);
      return row?.id ?? null;
    });
  },

  /**
   * Title and body from one index, best first. `query` is a prepared
   * `to_tsquery` string; the feature builds it from the member's words.
   */
  async searchDocuments(input: {
    readonly ownerActorId: string;
    readonly query: string;
    readonly offset: number;
  }): Promise<readonly DocumentSearchHit[]> {
    return instrumented(eventSink, 'searchDocuments', async () => {
      const rows = (await searchDatabase.execute(sql`
        with hits as (
          select id, title, folder_id, html,
            ts_rank(search, to_tsquery('simple', ${input.query})) as score,
            updated_at
          from documents
          where owner_actor_id = ${input.ownerActorId}
            and search @@ to_tsquery('simple', ${input.query})
          order by score desc, updated_at desc, id
          limit ${DOCUMENT_SEARCH_PAGE} offset ${input.offset}
        )
        select id, title, folder_id as "folderId",
          ts_headline('simple', left(html, ${SNIPPET_SOURCE_CHARS}), to_tsquery('simple', ${input.query}),
            'StartSel="", StopSel="", MaxFragments=1, MaxWords=24, MinWords=8') as snippet
        from hits
        order by score desc, updated_at desc, id`)) as unknown as DocumentSearchHit[];
      return rows;
    });
  },

  async createDocument(input: {
    readonly id: string;
    readonly ownerActorId: string;
    readonly folderId: string | null;
    readonly titleBase: string;
    readonly uniqueTitle: (taken: readonly string[]) => string;
    readonly html: string;
    readonly admits: DriveAdmission;
  }): Promise<DocumentRecord> {
    return instrumented(eventSink, 'createDocument', () =>
      database.transaction(async (tx) => {
        const { ownerActorId, folderId } = input;
        await fenced(tx, ownerActorId, input.admits);
        await ownFolder(tx, ownerActorId, folderId);
        const held = await countOf(
          tx,
          sql`select count(*) as count from documents where owner_actor_id = ${ownerActorId}`,
        );
        if (held >= DRIVE_LIMITS.documents) throw driveFull();
        const taken = await tx
          .select({ title: documents.title })
          .from(documents)
          .where(
            and(
              eq(documents.ownerActorId, ownerActorId),
              folderId === null
                ? isNull(documents.folderId)
                : eq(documents.folderId, folderId),
              like(documents.title, `${input.titleBase}%`),
            ),
          );
        const [row] = await tx
          .insert(documents)
          .values({
            id: input.id,
            ownerActorId,
            folderId,
            title: input.uniqueTitle(taken.map((one) => one.title)),
            html: input.html,
          })
          .returning(documentColumns);
        if (!row) throw new Error('Document insert returned no row');
        return row;
      }),
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
          updatedAt: now(),
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
    readonly admits: DriveAdmission;
  }): Promise<boolean> {
    return instrumented(eventSink, 'renameDocument', () =>
      database.transaction(async (tx) => {
        await fenced(tx, input.ownerActorId, input.admits);
        const rows = await tx
          .update(documents)
          .set({ title: input.title, updatedAt: now() })
          .where(
            and(
              eq(documents.id, input.id),
              eq(documents.ownerActorId, input.ownerActorId),
            ),
          )
          .returning({ id: documents.id });
        return rows.length === 1;
      }),
    );
  },

  async moveDocument(input: {
    readonly id: string;
    readonly ownerActorId: string;
    readonly folderId: string | null;
    readonly admits: DriveAdmission;
  }): Promise<boolean> {
    return instrumented(eventSink, 'moveDocument', () =>
      database.transaction(async (tx) => {
        await fenced(tx, input.ownerActorId, input.admits);
        await ownFolder(tx, input.ownerActorId, input.folderId);
        const rows = await tx
          .update(documents)
          .set({ folderId: input.folderId })
          .where(
            and(
              eq(documents.id, input.id),
              eq(documents.ownerActorId, input.ownerActorId),
            ),
          )
          .returning({ id: documents.id });
        return rows.length === 1;
      }),
    );
  },

  async deleteDocument(input: {
    readonly id: string;
    readonly ownerActorId: string;
    readonly admits: DriveAdmission;
  }): Promise<boolean> {
    return instrumented(eventSink, 'deleteDocument', () =>
      database.transaction(async (tx) => {
        await fenced(tx, input.ownerActorId, input.admits);
        const rows = await tx
          .delete(documents)
          .where(
            and(
              eq(documents.id, input.id),
              eq(documents.ownerActorId, input.ownerActorId),
            ),
          )
          .returning({ id: documents.id });
        return rows.length === 1;
      }),
    );
  },

  async createDocumentFolder(input: {
    readonly id: string;
    readonly ownerActorId: string;
    readonly parentFolderId: string | null;
    readonly name: string;
    readonly admits: DriveAdmission;
  }): Promise<void> {
    return instrumented(eventSink, 'createDocumentFolder', () =>
      database.transaction(async (tx) => {
        const { ownerActorId, parentFolderId } = input;
        await fenced(tx, ownerActorId, input.admits);
        await ownFolder(tx, ownerActorId, parentFolderId);
        const held = await countOf(
          tx,
          sql`select count(*) as count from document_folders where owner_actor_id = ${ownerActorId}`,
        );
        if (held >= DRIVE_LIMITS.folders) throw driveFull();
        const above = await ancestors(tx, ownerActorId, parentFolderId);
        if (above.length + 1 > DRIVE_LIMITS.depth) throw tooDeep();
        await tx.insert(documentFolders).values({
          id: input.id,
          ownerActorId,
          parentFolderId,
          name: input.name,
        });
      }),
    );
  },

  async renameDocumentFolder(input: {
    readonly id: string;
    readonly ownerActorId: string;
    readonly name: string;
    readonly admits: DriveAdmission;
  }): Promise<boolean> {
    return instrumented(eventSink, 'renameDocumentFolder', () =>
      database.transaction(async (tx) => {
        await fenced(tx, input.ownerActorId, input.admits);
        const rows = await tx
          .update(documentFolders)
          .set({ name: input.name, updatedAt: now() })
          .where(
            and(
              eq(documentFolders.id, input.id),
              eq(documentFolders.ownerActorId, input.ownerActorId),
            ),
          )
          .returning({ id: documentFolders.id });
        return rows.length === 1;
      }),
    );
  },

  /** Refuses a move into the folder's own subtree or past the depth limit. */
  async moveDocumentFolder(input: {
    readonly id: string;
    readonly ownerActorId: string;
    readonly parentFolderId: string | null;
    readonly admits: DriveAdmission;
  }): Promise<void> {
    return instrumented(eventSink, 'moveDocumentFolder', () =>
      database.transaction(async (tx) => {
        const { id, ownerActorId, parentFolderId } = input;
        await fenced(tx, ownerActorId, input.admits);
        await ownFolder(tx, ownerActorId, id);
        await ownFolder(tx, ownerActorId, parentFolderId);
        const above = await ancestors(tx, ownerActorId, parentFolderId);
        if (above.includes(id))
          throw createAppError(
            'CONFLICT',
            'A folder cannot move inside itself',
          );
        if (above.length + (await heightOf(tx, id)) > DRIVE_LIMITS.depth)
          throw tooDeep();
        await tx
          .update(documentFolders)
          .set({ parentFolderId })
          .where(eq(documentFolders.id, id));
      }),
    );
  },

  /** How many documents a folder's deletion would take, for its confirmation. */
  async countFolderDocuments(input: {
    readonly id: string;
    readonly ownerActorId: string;
  }): Promise<number> {
    return instrumented(eventSink, 'countFolderDocuments', () =>
      database.transaction(async (tx) => {
        await ownFolder(tx, input.ownerActorId, input.id);
        return countOf(
          tx,
          sql`
          with recursive down(id) as (
            select id from document_folders where id = ${input.id}
            union all
            select f.id from document_folders f join down on f.parent_folder_id = down.id
          )
          select count(*) as count from documents
          where folder_id in (select id from down)`,
        );
      }),
    );
  },

  /** Takes everything inside with it, in one statement, by the folder keys. */
  async deleteDocumentFolder(input: {
    readonly id: string;
    readonly ownerActorId: string;
    readonly admits: DriveAdmission;
  }): Promise<boolean> {
    return instrumented(eventSink, 'deleteDocumentFolder', () =>
      database.transaction(async (tx) => {
        await fenced(tx, input.ownerActorId, input.admits);
        const rows = await tx
          .delete(documentFolders)
          .where(
            and(
              eq(documentFolders.id, input.id),
              eq(documentFolders.ownerActorId, input.ownerActorId),
            ),
          )
          .returning({ id: documentFolders.id });
        return rows.length === 1;
      }),
    );
  },
});
