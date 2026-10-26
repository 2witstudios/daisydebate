'use client';

import { onlineCountsSchema } from '@daisy/protocol';
import {
  createBrowserConnectionStore,
  onDocumentVisibilityChange,
  systemScheduler,
} from '../../features/realtime/browser-adapters';
import { realtimeEndpointOf } from '../../features/realtime/endpoint-header';
import { startPresenceBeacon } from '../../features/realtime/presence-beacon';

/** How often the shell re-reads how many friends are online. */
const ONLINE_COUNTS_POLL_MS = 60_000;

type Listener = (friendsOnline: number) => void;

const listeners = new Set<Listener>();
let stopSession: (() => void) | null = null;

const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const onDocumentInput = (listener: () => void) => {
  for (const type of INPUT_EVENTS)
    document.addEventListener(type, listener, { passive: true });
  return () => {
    for (const type of INPUT_EVENTS)
      document.removeEventListener(type, listener);
  };
};

/**
 * One presence session per tab, however many shell parts read it: the
 * friends-online read, polled, and once that read names the realtime
 * endpoint, the presence socket (ADR 0072). A refused read (a visitor)
 * leaves both off.
 */
function startSession(): () => void {
  let stopped = false;
  let stopBeacon: (() => void) | null = null;
  const read = async () => {
    try {
      const response = await fetch('/api/friends/online', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (stopped || !response.ok) return;
      const counts = onlineCountsSchema.safeParse(await response.json());
      if (!counts.success) return;
      for (const listener of listeners) listener(counts.data.friendsOnline);
      const endpoint = realtimeEndpointOf(response);
      if (endpoint && !stopBeacon && !stopped)
        stopBeacon = startPresenceBeacon({
          connection: createBrowserConnectionStore(endpoint),
          scheduler: systemScheduler,
          isVisible: () => document.visibilityState === 'visible',
          onVisibilityChange: onDocumentVisibilityChange,
          onInput: onDocumentInput,
        });
    } catch {
      // A dropped read keeps the last count; the next poll tries again.
    }
  };
  void read();
  const poll = setInterval(() => void read(), ONLINE_COUNTS_POLL_MS);
  return () => {
    stopped = true;
    clearInterval(poll);
    stopBeacon?.();
  };
}

/** Joins the tab's presence session; the returned release leaves it. */
export function retainPresenceSession(listener: Listener): () => void {
  listeners.add(listener);
  stopSession ??= startSession();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopSession?.();
    stopSession = null;
  };
}
