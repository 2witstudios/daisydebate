'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

type Driver<T> = {
  readonly readSnapshot: () => T;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
};

type Held<T, D> = {
  readonly state: T;
  readonly driver: D | null;
};

function createHolder<T, D>(seed: T) {
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

/** First render reads the server seed. After hydration the driver owns the snapshots. */
export function useDriver<T, D extends Driver<T>>(
  seed: () => T,
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
