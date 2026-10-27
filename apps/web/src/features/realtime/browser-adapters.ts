import type {
  ConnectionStoreDeps,
  Scheduler,
  WebSocketLike,
} from './connection-store';
import {
  createConnectionStore,
  type ConnectionStore,
} from './connection-store';
import { fetchRealtimeTicket } from './ticket-client';
import { createTabPresence, type TabPresence } from './tab-presence';

/**
 * The real browser clock and timer queue (production `Scheduler`). Elapsed
 * time only ever needs a monotonic clock, so this reads `performance.now()`
 * rather than `Date.now()`: it is unaffected by a system clock adjustment
 * mid-connection, and the repo's ambient-time lint rule (which exists to
 * make ambient time an explicit, injected seam) does not restrict it, so
 * this file needs no exemption from that rule.
 */
export const systemScheduler: Scheduler = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * Backoff jitter needs a uniform value in [0, 1); reading it from the Web
 * Crypto CSPRNG rather than `Math.random` keeps this file lint-clean without
 * an exemption (the repo bans `Math.random`, not `crypto.getRandomValues`),
 * and costs nothing here since jitter is not on any hot path.
 */
function secureRandom(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0]! / 2 ** 32;
}

/** The real `document.visibilitychange` event, wrapped to the store's seam. */
export function onDocumentVisibilityChange(
  callback: (visible: boolean) => void,
  target: Pick<
    Document,
    'visibilityState' | 'addEventListener' | 'removeEventListener'
  > = document,
): () => void {
  const handler = () => callback(target.visibilityState === 'visible');
  target.addEventListener('visibilitychange', handler);
  return () => target.removeEventListener('visibilitychange', handler);
}

/**
 * Production wiring (no client library, ADR 0031 §3): the real global
 * `WebSocket`, `fetch`, `performance.now`/`setTimeout` and `document.
 * visibilitychange`. `url` is still an explicit argument — this module never
 * resolves the realtime origin itself, since that seam belongs to whoever
 * wires the store into a page (out of RT-2.6a's scope; see the handoff).
 */
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
function onDocumentInput(listener: () => void): () => void {
  for (const type of INPUT_EVENTS)
    document.addEventListener(type, listener, { passive: true });
  return () => {
    for (const type of INPUT_EVENTS)
      document.removeEventListener(type, listener);
  };
}

let tab: TabPresence | null = null;
/** This document's one presence, created with its first connection. */
export const browserTabPresence = (): TabPresence =>
  (tab ??= createTabPresence({
    scheduler: systemScheduler,
    isVisible: () => document.visibilityState === 'visible',
    onVisibilityChange: onDocumentVisibilityChange,
    onInput: onDocumentInput,
  }));

export function createBrowserConnectionStore(url: string): ConnectionStore {
  const deps: ConnectionStoreDeps = {
    url,
    // Every connection in the tab carries the tab's one activity (ADR 0072).
    reportsPresence: true,
    createSocket: (socketUrl: string): WebSocketLike =>
      new WebSocket(socketUrl),
    scheduler: systemScheduler,
    fetchTicket: () =>
      fetchRealtimeTicket({
        expectedSocketUrl: url,
        fetchImpl: (url, init) => fetch(url, init),
      }),
    random: secureRandom,
    onVisibilityChange: onDocumentVisibilityChange,
  };
  const store = createConnectionStore(deps);
  const detach = browserTabPresence().attach(store);
  return {
    ...store,
    close: () => {
      detach();
      store.close();
    },
    dispose: () => {
      detach();
      store.dispose();
    },
  };
}
