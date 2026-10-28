'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { observationResourceKey } from '@daisy/protocol';
import { tabObservations } from './observation-browser';
import type {
  ObservationDescriptor,
  ObservationView,
} from './observation-provider';

/**
 * `useRealtime(channelMessages(id), initial, socketUrl)`: the current view of
 * one observed resource. Without a socket URL (realtime off, or no
 * JavaScript upstream) it is the server-rendered body, never live.
 */
export function useRealtime<Body>(
  descriptor: ObservationDescriptor<Body>,
  initial: Body | null,
  socketUrl: string | null,
): ObservationView<Body> {
  const key = observationResourceKey(descriptor.resource);
  const fallback = useRef<ObservationView<Body>>({
    status: 'pending',
    body: initial,
  });
  const handle = useRef<{ readonly view: () => ObservationView<Body> } | null>(
    null,
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      if (socketUrl === null) return () => {};
      const held = tabObservations(socketUrl).observe(
        descriptor,
        initial,
        listener,
      );
      handle.current = held;
      listener();
      return () => {
        handle.current = null;
        held.release();
      };
    },
    // The descriptor is identified by its resource; initial seeds only the first observe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, socketUrl],
  );
  const view = useSyncExternalStore(
    subscribe,
    () => handle.current?.view() ?? fallback.current,
    () => fallback.current,
  );
  useEffect(() => {
    fallback.current = { status: 'pending', body: initial };
  }, [initial]);
  return view;
}
