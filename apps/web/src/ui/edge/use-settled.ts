'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { browserScheduler } from './browser-time';

/** How one read for a key ended. */
export type Settlement<T> =
  { readonly kind: 'ready'; readonly value: T } | { readonly kind: 'failed' };

/**
 * Reads once for each key and holds how the read ended, keyed by what it
 * was read for: a result belongs only to the key that produced it, and a
 * read whose key has since changed, or whose owner has left, is dropped. A
 * null key reads nothing. `waitMs` holds a read back until the key has
 * stayed the same that long (typing). `read` is read at its latest.
 */
export function useSettled<K, T>(
  key: K | null,
  read: (key: K) => Promise<T>,
  waitMs = 0,
): Settlement<T> | null {
  const [held, setHeld] = useState<{
    readonly key: K;
    readonly settlement: Settlement<T>;
  } | null>(null);
  const start = useEffectEvent(read);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const run = () =>
      start(key).then(
        (value) => {
          if (live) setHeld({ key, settlement: { kind: 'ready', value } });
        },
        () => {
          if (live) setHeld({ key, settlement: { kind: 'failed' } });
        },
      );
    if (waitMs <= 0) {
      void run();
      return () => {
        live = false;
      };
    }
    const cancel = browserScheduler.after(() => void run(), waitMs);
    return () => {
      live = false;
      cancel();
    };
  }, [key, waitMs]);
  return held !== null && key !== null && Object.is(held.key, key)
    ? held.settlement
    : null;
}
