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

/** The real browser clock and timer queue (production `Scheduler`). */
const systemScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** The real `document.visibilitychange` event, wrapped to the store's seam. */
function onDocumentVisibilityChange(
  callback: (visible: boolean) => void,
): () => void {
  const handler = () => callback(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

/**
 * Production wiring (no client library, ADR 0031 §3): the real global
 * `WebSocket`, `fetch`, `Date.now`/`setTimeout` and `document.
 * visibilitychange`. `url` is still an explicit argument — this module never
 * resolves the realtime origin itself, since that seam belongs to whoever
 * wires the store into a page (out of RT-2.6a's scope; see the handoff).
 */
export function createBrowserConnectionStore(url: string): ConnectionStore {
  const deps: ConnectionStoreDeps = {
    url,
    createSocket: (socketUrl: string): WebSocketLike =>
      new WebSocket(socketUrl),
    scheduler: systemScheduler,
    fetchTicket: () =>
      fetchRealtimeTicket({ fetchImpl: (url, init) => fetch(url, init) }),
    random: () => Math.random(),
    onVisibilityChange: onDocumentVisibilityChange,
  };
  return createConnectionStore(deps);
}
