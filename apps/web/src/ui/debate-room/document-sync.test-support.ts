import type {
  DraftStorage,
  StoredDocument,
  Timers,
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
export const memoryStorage = (): DraftStorage &
  { readonly dump: () => ReadonlyMap<string, string> } => {
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
