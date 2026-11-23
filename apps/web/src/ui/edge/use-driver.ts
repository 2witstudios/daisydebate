'use client';

import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from 'react';

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

/** Something held open until its owner lets it go. */
export type Disposable = { readonly dispose: () => void };

/**
 * Holds one resource for each key: opened after the page has rendered,
 * disposed when the key changes or the owner leaves, and returned to the
 * owner (null before it opens, and while a key has none). The key decides
 * the resource's identity, compared with `Object.is`; `open` is read at its
 * latest when a key opens.
 */
export function useResource<K, R extends Disposable>(
  key: K,
  open: (key: K) => R | null,
): R | null {
  const [holder] = useState(() =>
    createHolder<{ readonly key: K; readonly resource: R } | null, never>(null),
  );
  const start = useEffectEvent(open);
  useEffect(() => {
    const resource = start(key);
    if (resource === null) return;
    const held = { key, resource };
    holder.hold({ state: held, driver: null });
    return () => {
      resource.dispose();
      if (holder.read().state === held)
        holder.hold({ state: null, driver: null });
    };
  }, [holder, key]);
  const held = useSyncExternalStore(
    holder.subscribe,
    holder.read,
    holder.initial,
  ).state;
  return held !== null && Object.is(held.key, key) ? held.resource : null;
}
