import { fixedClock, fixedIds } from '@daisy/clock';
import type { DocumentRecord, DriveAdmission } from '@daisy/db/documents';
import { createAppError } from '@daisy/errors';
import {
  createDocumentOperations,
  type DocumentStore,
} from './document-operations';

export const NOW = '2026-10-05T18:00:00.000Z';

/** An admitted account, as the fence would read it. */
const admittedAccount = {
  member: true,
  erased: false,
  restricted: false,
  ageBand: 'adult',
  beta: { state: 'approved', revision: 1 },
} as unknown as Parameters<DriveAdmission>[0];

/** An in-memory store with the database adapter's semantics. */
const memoryStore = (seed: DocumentRecord[] = []) => {
  const documents = new Map(seed.map((d) => [d.id, d]));
  const owned = (id: string, ownerActorId: string) => {
    const found = documents.get(id);
    return found?.ownerActorId === ownerActorId ? found : undefined;
  };
  const refuseUnadmitted = (admits: DriveAdmission) => {
    if (!admits(admittedAccount)) throw createAppError('AUTHORIZATION');
  };
  const store: DocumentStore = {
    createDocument: async (input) => {
      refuseUnadmitted(input.admits);
      // The database stamps created_at/updated_at itself (ADR 0033 §3.2).
      const taken = [...documents.values()]
        .filter((d) => d.ownerActorId === input.ownerActorId)
        .map((d) => d.title);
      const record = {
        id: input.id,
        ownerActorId: input.ownerActorId,
        folderId: input.folderId,
        title: input.uniqueTitle(taken),
        html: input.html,
        revision: 1,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      };
      documents.set(record.id, record);
      return record;
    },
    readDocuments: async ({ ownerActorId, ids }) =>
      ids.flatMap((id) => owned(id, ownerActorId) ?? []),
    lastEditedDocument: async ({ ownerActorId }) =>
      [...documents.values()].find((d) => d.ownerActorId === ownerActorId)
        ?.id ?? null,
    listDriveEntries: async ({ ownerActorId, folderId, limit }) =>
      [...documents.values()]
        .filter(
          (d) => d.ownerActorId === ownerActorId && d.folderId === folderId,
        )
        .slice(0, limit)
        .map((d) => ({
          kind: 'document',
          id: d.id,
          title: d.title,
          folderId,
          updatedAt: d.updatedAt,
        })),
    listDocumentFolders: async () => [],
    searchDocuments: async () => [],
    saveDocument: async ({ id, ownerActorId, html, expectedRevision }) => {
      const found = owned(id, ownerActorId);
      if (!found) return { status: 'missing' };
      if (found.revision !== expectedRevision)
        return { status: 'conflict', revision: found.revision };
      documents.set(id, { ...found, html, revision: found.revision + 1 });
      return { status: 'saved', revision: found.revision + 1 };
    },
    renameDocument: async ({ id, ownerActorId, title }) => {
      const found = owned(id, ownerActorId);
      if (!found) return false;
      documents.set(id, { ...found, title });
      return true;
    },
    moveDocument: async ({ id, ownerActorId, folderId }) => {
      const found = owned(id, ownerActorId);
      if (!found) return false;
      documents.set(id, { ...found, folderId });
      return true;
    },
    deleteDocument: async ({ id, ownerActorId }) =>
      owned(id, ownerActorId) ? documents.delete(id) : false,
    createDocumentFolder: async () => {},
    renameDocumentFolder: async () => true,
    moveDocumentFolder: async () => {},
    countFolderDocuments: async () => 0,
    deleteDocumentFolder: async () => true,
  };
  return { store, documents };
};

export const stored = (
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord => ({
  id: 'doc-1',
  ownerActorId: 'actor-me',
  folderId: null,
  title: 'Notes',
  html: '<p>a</p>',
  revision: 1,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  ...overrides,
});

export const operationsOver = (seed: DocumentRecord[] = []) => {
  const { store, documents } = memoryStore(seed);
  const operations = createDocumentOperations({
    store,
    clock: fixedClock(NOW),
    ids: fixedIds(['doc-new']),
  });
  return { operations, documents };
};
