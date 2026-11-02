import { newNoteCopy, type NoteCopy } from './note-draft';
import { createKeepaliveBudget } from './keepalive-budget';
import type { DraftStorage } from './note-draft-storage';
import { createDocumentSync } from './document-sync';
import type {
  DocumentsApi,
  StoredDocument,
  Timers,
  DocumentSyncResources,
} from './document-sync';

export const stored = (id: string, revision = 1): StoredDocument => ({
  id,
  title: id,
  folder: 'round',
  templateId: 'flow',
  html: '<p>\n</p>',
  createdAt: '2026-10-05T18:00:00.000Z',
  updatedAt: '2026-10-05T18:00:00.000Z',
  revision,
});

/** A mutable in-memory storage seam for draft recovery tests. */
export const memoryStorage = (): DraftStorage & {
  readonly dump: () => ReadonlyMap<string, string>;
} => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (key === 'no-room') throw new Error('quota');
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    dump: () => new Map(map),
  };
};

/** Timers that fire only when the test says so. */
export const manualTimers = () => {
  const queued = new Map<number, () => void>();
  let next = 0;
  const timers: Timers = {
    set: (run) => {
      next += 1;
      queued.set(next, run);
      return next;
    },
    clear: (handle) => void queued.delete(handle as number),
  };
  const fire = () => {
    const runs = [...queued.values()];
    queued.clear();
    for (const run of runs) run();
  };
  return { timers, fire };
};

/** Each injected owner gets a deterministic, independent generation sequence. */
const manualGenerations = (owner: string) => {
  let index = 0;
  return () => `${owner}:${++index}`;
};

/** Isolated deterministic test resources; multi-owner budget tests pass their shared ledger explicitly. */
export const manualNoteResources = (
  owner: string,
  overrides: Omit<Partial<DocumentSyncResources>, 'nextGeneration'> = {},
): DocumentSyncResources => ({
  nextGeneration: manualGenerations(owner),
  wallClock: () => 100,
  timers: manualTimers().timers,
  storage: null,
  budget: createKeepaliveBudget(),
  ...overrides,
});

/** A valid recovery fixture keeps the supplied identity/base/time and derives only its fixed retention. */
export const recoveryRecord = ({
  html,
  baseRevision,
  generation,
  savedAt,
}: Pick<
  NoteCopy,
  'html' | 'baseRevision' | 'generation' | 'savedAt'
>): string =>
  JSON.stringify({
    recovery: newNoteCopy({ html, baseRevision, generation, now: savedAt }),
  });

export const noteHtml = (size: number): string =>
  `<p>${'x'.repeat(Math.max(size - 13, 0))}</p>`;

/** Every stub keeps its declared server documents and records the real save input. */
export const documentApi = (
  save: DocumentsApi['save'],
  documents: () => readonly StoredDocument[],
): DocumentsApi => ({
  list: async () => documents(),
  create: async () => stored('new'),
  save,
});

export const recordingSave =
  (
    sent: string[],
    {
      wait,
      revision,
    }: { readonly wait?: Promise<void>; readonly revision?: number } = {},
  ): DocumentsApi['save'] =>
  async ({ html, expectedRevision }) => {
    sent.push(html);
    if (wait) await wait;
    return { status: 'saved', revision: revision ?? expectedRevision + 1 };
  };

/** The same actual coordinator and transport, with its initial load completed. */
export const loadNoteSync = async (
  options: Parameters<typeof createDocumentSync>[0],
) => {
  const sync = createDocumentSync(options);
  await sync.load();
  return sync;
};

/** Dispatch overlapping exit events against the same loaded owner and exact edit sizes. */
export const overlappingNoteExit = async (
  sync: ReturnType<typeof createDocumentSync>,
  release: () => void,
) => {
  sync.change('a', noteHtml(26_000));
  sync.change('b', noteHtml(60_000));
  const first = sync.flushKeepalive();
  const second = sync.flushKeepalive();
  release();
  await Promise.all([first, second]);
};
