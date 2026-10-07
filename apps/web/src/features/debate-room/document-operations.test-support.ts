import { fixedClock, fixedIds } from '@daisy/clock';
import type { DocumentRecord } from '@daisy/db';
import { emptyRuntimeCheckpoint } from '@daisy/protocol';
import {
  createDebateDocumentOperations,
  type DebateDocumentStore,
} from './document-operations';

export const NOW = '2026-10-05T18:00:00.000Z';

/** The round the tests sit in: the tester participates, on the negative. */
const round = {
  id: 'debate-1',
  formatId: 'one-on-one',
  formatVersion: 1,
  resolution: 'A representative resolution',
  status: 'scheduled' as const,
  currentStage: null,
  startedAt: null,
  completedAt: null,
  outcome: null,
  rules: {
    version: 2 as const,
    seats: { affirmative: 1, negative: 1, judge: 1 },
    segments: [
      {
        key: 'AC',
        label: 'Affirmative constructive',
        type: 'speech' as const,
        side: 'affirmative' as const,
        slot: 0,
        durationMs: 300_000,
      },
      {
        key: 'NC',
        label: 'Negative constructive',
        type: 'speech' as const,
        side: 'negative' as const,
        slot: 0,
        durationMs: 360_000,
      },
    ],
    inRoundPrep: null,
    countdownMs: 10_000,
    interaction: {
      crossExMode: 'ordered' as const,
      yield: null,
      interruptions: null,
    },
  },
  checkpoint: emptyRuntimeCheckpoint,
  version: 1,
  participants: [
    { id: 'seat-me', actorId: 'actor-me', role: 'negative' as const, slot: 0 },
    {
      id: 'seat-other',
      actorId: 'actor-other',
      role: 'affirmative' as const,
      slot: 0,
    },
    {
      id: 'seat-judge',
      actorId: 'actor-judge',
      role: 'judge' as const,
      slot: 0,
    },
  ],
  segments: [],
};

/** An in-memory store with the database adapter's semantics. */
const memoryStore = (seed: DocumentRecord[] = []) => {
  const documents = new Map(seed.map((d) => [d.id, d]));
  const refs = new Set<string>();
  const owned = (id: string, ownerActorId: string) => {
    const found = documents.get(id);
    return found?.ownerActorId === ownerActorId ? found : undefined;
  };
  const store: DebateDocumentStore = {
    getRound: async (id) => (id === round.id ? round : null),
    createDocument: async (document) => {
      // The database stamps created_at/updated_at itself (ADR 0033 §3.2).
      const record = {
        ...document,
        revision: 1,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      };
      documents.set(record.id, record);
      return record;
    },
    listDocuments: async ({ ownerActorId, roundId }) => {
      const referenced = new Set(
        [...refs]
          .filter(([refRound]) => refRound === roundId)
          .map(([, documentId]) => documentId),
      );
      return [...documents.values()].filter(
        (d) => d.ownerActorId === ownerActorId || referenced.has(d.id),
      );
    },
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
      if (!found) return null;
      const renamed = { ...found, title };
      documents.set(id, renamed);
      return renamed;
    },
    attachRoundDocument: async ({ roundId, documentId }) => {
      refs.add(`${roundId}:${documentId}`);
    },
  };
  return { store, documents, refs };
};

export const stored = (
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord => ({
  id: 'doc-1',
  ownerActorId: 'actor-me',
  folder: 'scratch',
  templateId: 'flow',
  title: 'Flow',
  html: '<p>a</p>',
  revision: 1,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  ...overrides,
});

export const operationsOver = (seed: DocumentRecord[] = []) => {
  const { store, documents } = memoryStore(seed);
  const operations = createDebateDocumentOperations({
    store,
    clock: fixedClock(NOW),
    ids: fixedIds(['doc-new']),
  });
  return { operations, documents };
};
