'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ResourceSync } from '../../features/resource-sync/resource-sync';

type Driver<T> = {
  readonly readSnapshot: () => ResourceSync<T>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
};

type Held<T, D> = {
  readonly state: ResourceSync<T>;
  readonly driver: D | null;
};

/** Where the running driver's snapshots meet React's render. */
function createHolder<T, D>(seed: ResourceSync<T>) {
  let held: Held<T, D> = { state: seed, driver: null };
  const listeners = new Set<() => void>();
  const initial = held;
  return {
    read: () => held,
    initial: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hold(next: Held<T, D>) {
      held = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Holds a synced resource for a page (ADR 0066). The first render shows the
 * server's seed, so hydration matches; the driver `start` makes after
 * hydration takes over. A changed `start` replaces the driver.
 */
export function useResourceSync<T, D extends Driver<T>>(
  seed: () => ResourceSync<T>,
  start: () => D,
) {
  const [holder] = useState(() => createHolder<T, D>(seed()));
  useEffect(() => {
    const running = start();
    const hold = () =>
      holder.hold({ state: running.readSnapshot(), driver: running });
    const stop = running.subscribe(hold);
    hold();
    return () => {
      stop();
      running.dispose();
      holder.hold({ state: running.readSnapshot(), driver: null });
    };
  }, [holder, start]);
  const held = useSyncExternalStore(
    holder.subscribe,
    holder.read,
    holder.initial,
  );
  return [held.state, held.driver] as const;
}
