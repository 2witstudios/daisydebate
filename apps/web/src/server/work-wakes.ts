import type { WorkKind } from '@daisy/db';
import type { WorkWake } from '../lib/worker-loop';

/**
 * The process's worker wakes (ADR 0153): each worker loop subscribes to the
 * kinds of work it looks for; a NOTIFY on `daisy_work` wakes those loops,
 * and a (re)established LISTEN wakes every loop once, since notifications
 * sent while it was down are lost.
 */
export function createWorkWakes() {
  const listeners = new Map<WorkKind, Set<() => void>>();
  const call = (kind: WorkKind) => {
    for (const listener of listeners.get(kind) ?? []) listener();
  };
  return {
    of: (...kinds: readonly WorkKind[]): WorkWake => ({
      subscribe: (listener) => {
        for (const kind of kinds) {
          const set = listeners.get(kind) ?? new Set();
          set.add(listener);
          listeners.set(kind, set);
        }
        return () => {
          for (const kind of kinds) listeners.get(kind)?.delete(listener);
        };
      },
    }),
    wake: call,
    wakeAll: () => {
      const every = new Set([...listeners.values()].flatMap((set) => [...set]));
      for (const listener of every) listener();
    },
  };
}
export type WorkWakes = ReturnType<typeof createWorkWakes>;
