import { observationResourceKey, type ObservationBase } from '@daisy/protocol';
import type { ObservationSnapshot } from './observation-node';

/** Redis-only node repair: refresh expiring demand and read current heads,
 * for every local key or one hinted resource. A request that arrives while
 * a pass runs schedules one more complete pass rather than being lost.
 */
export function createObservationRepair({
  keys,
  current,
  accept,
  touch,
  yieldWork,
  closed,
  cache,
}: {
  readonly keys: () => readonly (readonly [string, ObservationBase])[];
  readonly current: (key: string, base: ObservationBase) => boolean;
  readonly accept: (snapshot: ObservationSnapshot) => unknown;
  readonly touch: (key: string) => void;
  readonly yieldWork: () => Promise<void>;
  readonly closed: () => boolean;
  readonly cache: {
    readonly demand: (base: ObservationBase) => Promise<void>;
    readonly read: (
      base: ObservationBase,
    ) => Promise<ObservationSnapshot | null>;
  };
}) {
  let running = false,
    again = false;
  async function pass(resourceKey: string | undefined) {
    let count = 0;
    for (const [key, base] of keys()) {
      if (closed()) return;
      if (resourceKey && observationResourceKey(base.resource) !== resourceKey)
        continue;
      await cache.demand(base);
      const snapshot = await cache.read(base);
      if (closed() || !current(key, base)) continue;
      if (snapshot) accept(snapshot);
      touch(key);
      if (++count % 128 === 0) await yieldWork();
    }
  }
  async function repair(resourceKey?: string): Promise<void> {
    if (closed()) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await pass(resourceKey);
    } finally {
      running = false;
    }
    if (again && !closed()) {
      again = false;
      await repair();
    }
  }
  return repair;
}
