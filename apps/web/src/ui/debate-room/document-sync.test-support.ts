import type { StoredDocument, Timers } from './document-sync';

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
