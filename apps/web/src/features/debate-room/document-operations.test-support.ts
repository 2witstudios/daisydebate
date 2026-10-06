import { fixedClock, fixedIds } from '@daisy/clock';
import type { AiDebateRecord, DebateDocumentRecord } from '@daisy/db';
import {
  createDebateDocumentOperations,
  type DebateDocumentStore,
} from './document-operations';

export const NOW = '2026-10-05T18:00:00.000Z';

const debate = {
  id: 'debate-1',
  actorId: 'actor-me',
  personSide: 'negative',
} as AiDebateRecord;

/** An in-memory store with the database adapter's semantics. */
const memoryStore = (seed: DebateDocumentRecord[] = []) => {
  const documents = new Map(seed.map((d) => [d.id, d]));
  const owned = (id: string, ownerUserId: string) => {
    const found = documents.get(id);
    return found?.ownerUserId === ownerUserId ? found : undefined;
  };
  const store: DebateDocumentStore = {
    getAiDebate: async (id) => (id === debate.id ? debate : null),
    createDebateDocument: async (document) => {
      const record = {
        ...document,
        revision: 1,
        updatedAt: document.createdAt,
      };
      documents.set(record.id, record);
      return record;
    },
    listDebateDocuments: async ({ ownerUserId, aiDebateId }) =>
      [...documents.values()].filter(
        (d) =>
          d.ownerUserId === ownerUserId &&
          (d.aiDebateId === aiDebateId || d.folder === 'library'),
      ),
    saveDebateDocument: async ({ id, ownerUserId, html, expectedRevision }) => {
      const found = owned(id, ownerUserId);
      if (!found) return { status: 'missing' };
      if (found.revision !== expectedRevision)
        return { status: 'conflict', revision: found.revision };
      documents.set(id, { ...found, html, revision: found.revision + 1 });
      return { status: 'saved', revision: found.revision + 1 };
    },
    renameDebateDocument: async ({ id, ownerUserId, title, updatedAt }) => {
      const found = owned(id, ownerUserId);
      if (!found) return null;
      const renamed = { ...found, title, updatedAt };
      documents.set(id, renamed);
      return renamed;
    },
  };
  return { store, documents };
};

export const stored = (
  overrides: Partial<DebateDocumentRecord> = {},
): DebateDocumentRecord => ({
  id: 'doc-1',
  ownerUserId: 'user-me',
  aiDebateId: 'debate-1',
  folder: 'round',
  templateId: 'flow',
  title: 'Flow',
  html: '<p>a</p>',
  revision: 1,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  ...overrides,
});

export const operationsOver = (seed: DebateDocumentRecord[] = []) => {
  const { store, documents } = memoryStore(seed);
  const operations = createDebateDocumentOperations({
    store,
    clock: fixedClock(NOW),
    ids: fixedIds(['doc-new']),
  });
  return { operations, documents };
};
