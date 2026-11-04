import type {
  DocumentRecord,
  DriveAdmission,
  DriveEntry,
  DocumentSearchHit,
} from '@daisy/db/documents';
import {
  DOCUMENT_READ_MAX,
  DOCUMENT_SEARCH_PAGE,
  DRIVE_PAGE_SIZE,
} from '@daisy/db/documents';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { Database } from '@daisy/db';
import { participantAccess } from '@daisy/auth/authorization';
import { createAppError, isAppError, type AppError } from '@daisy/errors';
import {
  createDocument as buildDocument,
  uniqueTitle,
  type MemberDocument,
} from './document';
import type { DriveCursor, DriveEntryView } from './drive-tree';
import { blockText } from './document-edits';
import { normalizeDocumentHtml } from './normalize-html';
import { documentSearchQuery } from './search-query';

export type DocumentStore = Pick<
  Database,
  | 'createDocument'
  | 'readDocuments'
  | 'lastEditedDocument'
  | 'listDriveEntries'
  | 'listDocumentFolders'
  | 'searchDocuments'
  | 'saveDocument'
  | 'renameDocument'
  | 'moveDocument'
  | 'deleteDocument'
  | 'createDocumentFolder'
  | 'renameDocumentFolder'
  | 'moveDocumentFolder'
  | 'countFolderDocuments'
  | 'deleteDocumentFolder'
>;

/** The signed-in user and their competitive actor, resolved at the edge. */
export type DocumentPrincipal = {
  readonly userId: string;
  readonly actorId: string;
};

/** A stored document as a manager shows it, with its save revision. */
export type StoredDocument = MemberDocument & { readonly revision: number };

const NAME_MAX = 120;

/** A save against a stale revision; `revision` is the current one. */
type DocumentConflict = AppError & { readonly revision: number };

const conflict = (revision: number): DocumentConflict =>
  Object.assign(createAppError('CONFLICT', 'The document moved on'), {
    revision,
  });

/** The current revision a refused save reported, or null for other errors. */
export const conflictRevision = (error: unknown): number | null =>
  isAppError(error) &&
  error.code === 'CONFLICT' &&
  typeof (error as Partial<DocumentConflict>).revision === 'number'
    ? (error as DocumentConflict).revision
    : null;

const toStored = (record: DocumentRecord): StoredDocument => ({
  id: record.id,
  title: record.title,
  html: record.html,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  revision: record.revision,
});

const toEntryView = (entry: DriveEntry): DriveEntryView =>
  entry.kind === 'folder'
    ? { kind: 'folder', id: entry.id, name: entry.name }
    : { kind: 'document', id: entry.id, title: entry.title };

const cursorOf = (entry: DriveEntry): DriveCursor => ({
  kind: entry.kind,
  label: entry.kind === 'folder' ? entry.name : entry.title,
  id: entry.id,
});

const normalized = (html: string) => {
  const result = normalizeDocumentHtml(html);
  if (result.ok) return result.html;
  throw createAppError(
    result.reason === 'too-large' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION',
  );
};

const nameOf = (value: string) => {
  const name = value.trim();
  if (name.length < 1 || name.length > NAME_MAX)
    throw createAppError('VALIDATION', 'Name length');
  return name;
};

const found = (changed: boolean) => {
  if (!changed) throw createAppError('NOT_FOUND');
};

/**
 * ADR 0075 under the account fence: only an admitted, open account changes its
 * drive. A closed, restricted, revoked or under-age account keeps export and
 * account erasure, which do not come through here (ADR 0111).
 */
const admits: DriveAdmission = (account) =>
  account !== null &&
  account.member &&
  !account.erased &&
  participantAccess(account);

/**
 * A member's documents (ADR 0054, ADR 0058 §9, ADR 0111). They are the member's,
 * owned by their actor, and no Round is asked about them: every call names its
 * principal and reaches only their documents. HTML is normalized before it is
 * stored, and time and ids come from the injected clock and generator.
 */
export function createDocumentOperations({
  store,
  clock,
  ids,
}: {
  readonly store: DocumentStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}) {
  return {
    /** One page of a folder, with no body: the only way a drive is listed. */
    async listDrive(
      principal: DocumentPrincipal,
      input: {
        readonly folderId: string | null;
        readonly after: DriveCursor | null;
      },
    ): Promise<{
      readonly entries: readonly DriveEntryView[];
      readonly next: DriveCursor | null;
    }> {
      const rows = await store.listDriveEntries({
        ownerActorId: principal.actorId,
        folderId: input.folderId,
        after: input.after,
        limit: DRIVE_PAGE_SIZE + 1,
      });
      const page = rows.slice(0, DRIVE_PAGE_SIZE);
      return {
        entries: page.map(toEntryView),
        next:
          rows.length > DRIVE_PAGE_SIZE
            ? cursorOf(page[page.length - 1]!)
            : null,
      };
    },

    /** Every folder, for a Move form; a drive's folder count is bounded. */
    async listFolders(principal: DocumentPrincipal) {
      return store.listDocumentFolders({ ownerActorId: principal.actorId });
    },

    /** Only the caller's own bodies; another's id simply reads as absent. */
    async readDocuments(
      principal: DocumentPrincipal,
      input: { readonly ids: readonly string[] },
    ): Promise<readonly StoredDocument[]> {
      if (input.ids.length > DOCUMENT_READ_MAX)
        throw createAppError('VALIDATION', 'Too many documents');
      const records = await store.readDocuments({
        ownerActorId: principal.actorId,
        ids: input.ids,
      });
      return records.map(toStored);
    },

    /** The document to land on when nothing is open. */
    async lastEdited(principal: DocumentPrincipal) {
      return {
        id: await store.lastEditedDocument({ ownerActorId: principal.actorId }),
      };
    },

    /** Title and body from one index, paged. The words are never logged. */
    async search(
      principal: DocumentPrincipal,
      input: { readonly text: string; readonly page: number },
    ): Promise<readonly DocumentSearchHit[]> {
      const query = documentSearchQuery(input.text);
      if (query === null) return [];
      const hits = await store.searchDocuments({
        ownerActorId: principal.actorId,
        query,
        offset: input.page * DOCUMENT_SEARCH_PAGE,
      });
      // The snippet is cut from stored HTML, so it shows as words, not markup.
      return hits.map((hit) => ({ ...hit, snippet: blockText(hit.snippet) }));
    },

    async createDocument(
      principal: DocumentPrincipal,
      input: { readonly folderId: string | null },
    ): Promise<StoredDocument> {
      const id = ids.next();
      const now = clock.now();
      const blank = buildDocument({ id, now, existingTitles: [] });
      const record = await store.createDocument({
        id,
        ownerActorId: principal.actorId,
        folderId: input.folderId,
        titleBase: blank.title,
        uniqueTitle: (taken) => uniqueTitle(blank.title, taken),
        html: normalized(blank.html),
        admits,
      });
      return toStored(record);
    },

    async saveDocument(
      principal: DocumentPrincipal,
      input: {
        readonly id: string;
        readonly html: string;
        readonly expectedRevision: number;
      },
    ): Promise<{ readonly revision: number }> {
      const saved = await store.saveDocument({
        id: input.id,
        ownerActorId: principal.actorId,
        html: normalized(input.html),
        expectedRevision: input.expectedRevision,
      });
      if (saved.status === 'missing') throw createAppError('NOT_FOUND');
      if (saved.status === 'conflict') throw conflict(saved.revision);
      return { revision: saved.revision };
    },

    async renameDocument(
      principal: DocumentPrincipal,
      input: { readonly id: string; readonly title: string },
    ): Promise<void> {
      found(
        await store.renameDocument({
          id: input.id,
          ownerActorId: principal.actorId,
          title: nameOf(input.title),
          admits,
        }),
      );
    },

    async moveDocument(
      principal: DocumentPrincipal,
      input: { readonly id: string; readonly folderId: string | null },
    ): Promise<void> {
      found(
        await store.moveDocument({
          id: input.id,
          ownerActorId: principal.actorId,
          folderId: input.folderId,
          admits,
        }),
      );
    },

    async deleteDocument(
      principal: DocumentPrincipal,
      input: { readonly id: string },
    ): Promise<void> {
      found(
        await store.deleteDocument({
          id: input.id,
          ownerActorId: principal.actorId,
          admits,
        }),
      );
    },

    async createFolder(
      principal: DocumentPrincipal,
      input: { readonly parentFolderId: string | null; readonly name: string },
    ): Promise<DriveEntryView> {
      const id = ids.next();
      const name = nameOf(input.name);
      await store.createDocumentFolder({
        id,
        ownerActorId: principal.actorId,
        parentFolderId: input.parentFolderId,
        name,
        admits,
      });
      return { kind: 'folder', id, name };
    },

    async renameFolder(
      principal: DocumentPrincipal,
      input: { readonly id: string; readonly name: string },
    ): Promise<void> {
      found(
        await store.renameDocumentFolder({
          id: input.id,
          ownerActorId: principal.actorId,
          name: nameOf(input.name),
          admits,
        }),
      );
    },

    async moveFolder(
      principal: DocumentPrincipal,
      input: { readonly id: string; readonly parentFolderId: string | null },
    ): Promise<void> {
      await store.moveDocumentFolder({
        id: input.id,
        ownerActorId: principal.actorId,
        parentFolderId: input.parentFolderId,
        admits,
      });
    },

    /** How many documents a folder's deletion takes, for its confirmation. */
    async folderDocumentCount(
      principal: DocumentPrincipal,
      input: { readonly id: string },
    ): Promise<number> {
      return store.countFolderDocuments({
        id: input.id,
        ownerActorId: principal.actorId,
      });
    },

    async deleteFolder(
      principal: DocumentPrincipal,
      input: { readonly id: string },
    ): Promise<void> {
      found(
        await store.deleteDocumentFolder({
          id: input.id,
          ownerActorId: principal.actorId,
          admits,
        }),
      );
    },
  };
}

export type DocumentOperations = ReturnType<typeof createDocumentOperations>;
