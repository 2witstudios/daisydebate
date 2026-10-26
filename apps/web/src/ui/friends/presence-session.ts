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

type SessionPorts = {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Opens the presence socket at `endpoint`; returns its stop. */
  readonly startBeacon: (endpoint: string) => () => void;
  readonly setInterval: (callback: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};

/**
 * One presence session per tab, however many shell parts read it: the
 * friends-online read, polled, and once that read names the realtime
 * endpoint, the presence socket (ADR 0072). A refused read (a visitor)
 * leaves both off; a dropped one keeps the last count.
 */
export function createPresenceSessions(ports: SessionPorts) {
  const listeners = new Set<Listener>();
  let stopSession: (() => void) | null = null;
  function start(): () => void {
    let stopped = false;
    let stopBeacon: (() => void) | null = null;
    const read = async () => {
      try {
        const response = await ports.fetch('/api/friends/online', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (stopped || !response.ok) return;
        // jitless: the strict CSP refuses Zod's eval-compiled parser.
        const counts = onlineCountsSchema.safeParse(await response.json(), {
          jitless: true,
        });
        if (!counts.success) return;
        for (const listener of listeners) listener(counts.data.friendsOnline);
        const endpoint = realtimeEndpointOf(response);
        if (endpoint && !stopBeacon && !stopped)
          stopBeacon = ports.startBeacon(endpoint);
      } catch {
        // The next poll tries again.
      }
    };
    void read();
    const poll = ports.setInterval(() => void read(), ONLINE_COUNTS_POLL_MS);
    return () => {
      stopped = true;
      ports.clearInterval(poll);
      stopBeacon?.();
    };
  }
  /** Joins the tab's session; the returned release leaves it. */
  return (listener: Listener): (() => void) => {
    listeners.add(listener);
    stopSession ??= start();
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      stopSession?.();
      stopSession = null;
    };
  };
}

const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const onDocumentInput = (listener: () => void) => {
  for (const type of INPUT_EVENTS)
    document.addEventListener(type, listener, { passive: true });
  return () => {
    for (const type of INPUT_EVENTS)
      document.removeEventListener(type, listener);
  };
};

/** This tab's presence session over the browser's own fetch, timers and socket. */
export const retainPresenceSession = createPresenceSessions({
  fetch: (url, init) => fetch(url, init),
  startBeacon: (endpoint) =>
    startPresenceBeacon({
      connection: createBrowserConnectionStore(endpoint),
      scheduler: systemScheduler,
      isVisible: () => document.visibilityState === 'visible',
      onVisibilityChange: onDocumentVisibilityChange,
      onInput: onDocumentInput,
    }),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
});
