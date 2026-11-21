'use client';

import { useBrowserEffect } from '../edge/browser-sync';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { tabObservations } from './observation-browser';
import type {
  ObservationDescriptor,
  ObservationView,
} from '../../features/realtime/observation-provider';

type Held<Body> = {
  readonly view: () => ObservationView<Body>;
  readonly offer: (body: Body) => void;
  readonly release: () => void;
};

/**
 * `useRealtime(channelMessages(id), initial, socketUrl)`: the current view of
 * one observed resource. A newer server render (`initial`) is offered to the
 * provider, which keeps whichever body is newer. Without a socket URL it is
 * the server-rendered body, never live.
 */
export function useRealtime<Body>(
  descriptor: ObservationDescriptor<Body>,
  initial: Body | null,
  socketUrl: string | null,
): ObservationView<Body> {
  const seed = useRef(initial);
  const held = useRef<Held<Body> | null>(null);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (socketUrl === null) return () => {};
      const handle = tabObservations(socketUrl).observe(
        descriptor,
        seed.current,
        listener,
      );
      held.current = handle;
      listener();
      return () => {
        held.current = null;
        handle.release();
      };
    },
    [descriptor, socketUrl],
  );
  const live = useSyncExternalStore(
    subscribe,
    () => held.current?.view() ?? null,
    () => null,
  );
  useBrowserEffect(() => {
    seed.current = initial;
    if (initial !== null) held.current?.offer(initial);
  }, [initial]);
  return live ?? { status: 'pending', body: initial };
}
