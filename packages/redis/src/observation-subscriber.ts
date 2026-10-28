import { RedisClient } from 'bun';
import type { ObservationResource } from '@daisy/protocol';
import {
  createObservationKeys,
  parseObservationHint,
  type ObservationHint,
} from './observation-cache';

/** The members of Bun's client the subscriber uses (Bun 1.4.2 Pub/Sub). */
export type SubscriberTransport = {
  connect(): Promise<void>;
  close(): void;
  subscribe(
    channels: string[],
    listener: (message: string, channel: string) => void,
  ): Promise<number>;
  unsubscribe(channel: string): Promise<void>;
  onclose: ((error: Error) => void) | null;
};
type Timers = {
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};
type ObservationSubscriberState =
  'connecting' | 'synchronized' | 'lost' | 'closed';
/** One process's channel ceiling: its node's resource interests. */
const OBSERVATION_MAX_CHANNELS = 1_024;
const BACKOFF_MS = [250, 500, 1_000, 2_000, 5_000] as const;

/**
 * One process's single managed Pub/Sub connection (ADR 0089, ADR 0008 as
 * amended), separate from its command connection. Hints are at-most-once:
 * a lost one is harmless because nodes also repair heads from Redis. After
 * any reconnect every channel is resubscribed and `onSynchronized` runs, so
 * the node reconciles heads before treating hints as current again.
 */
export function createObservationSubscriber({
  namespace,
  open,
  onHint,
  onSynchronized,
  onLost,
  timers = {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as number),
  },
}: {
  readonly namespace: string;
  /** Dials a fresh dedicated connection; never the command client. */
  readonly open: () => SubscriberTransport;
  readonly onHint: (
    resource: ObservationResource,
    hint: ObservationHint,
  ) => void;
  readonly onSynchronized: () => void;
  readonly onLost: () => void;
  readonly timers?: Timers;
}) {
  const keys = createObservationKeys(namespace);
  const wanted = new Map<string, ObservationResource>();
  let state: ObservationSubscriberState = 'connecting';
  let connection: SubscriberTransport | null = null;
  let attempt = 0;
  let retry: unknown = null;
  let epoch = 0;
  const listener = (message: string, channel: string) => {
    const resource = keys.hintResource(channel);
    const hint = parseObservationHint(message);
    if (state === 'synchronized' && resource && hint && wanted.has(channel))
      onHint(resource, hint);
  };
  function lose(current: number) {
    if (current !== epoch || state === 'closed') return;
    epoch++;
    connection?.close();
    connection = null;
    const wasSynchronized = state === 'synchronized';
    state = 'lost';
    if (wasSynchronized) onLost();
    const delay = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]!;
    retry = timers.setTimeout(() => {
      retry = null;
      void dial();
    }, delay);
  }
  async function dial() {
    if (state === 'closed') return;
    const current = ++epoch;
    const next = open();
    connection = next;
    next.onclose = () => lose(current);
    try {
      await next.connect();
      const channels = [...wanted.keys()];
      if (channels.length > 0) await next.subscribe(channels, listener);
      // close() may have run during the awaits; the epoch check covers it.
      if (current !== epoch) return;
      attempt = 0;
      state = 'synchronized';
      onSynchronized();
    } catch {
      lose(current);
    }
  }
  return {
    state: () => state,
    start() {
      if (connection === null && retry === null && state !== 'closed')
        void dial();
    },
    /** Starts hints for a resource; false at the channel ceiling. */
    async observe(resource: ObservationResource): Promise<boolean> {
      const channel = keys.hint(resource);
      if (wanted.has(channel)) return true;
      if (wanted.size >= OBSERVATION_MAX_CHANNELS) return false;
      wanted.set(channel, resource);
      const current = epoch;
      if (state === 'synchronized' && connection)
        await connection
          .subscribe([channel], listener)
          .catch(() => lose(current));
      return true;
    },
    async forget(resource: ObservationResource) {
      const channel = keys.hint(resource);
      if (!wanted.delete(channel)) return;
      const current = epoch;
      if (state === 'synchronized' && connection)
        await connection.unsubscribe(channel).catch(() => lose(current));
    },
    close() {
      state = 'closed';
      epoch++;
      if (retry !== null) timers.clearTimeout(retry);
      retry = null;
      connection?.close();
      connection = null;
      wanted.clear();
    },
  };
}

/** The production dialer: a dedicated connection that never queues offline. */
export const dialObservationSubscriber =
  (url: string) => (): SubscriberTransport => {
    const client = new RedisClient(url, {
      connectionTimeout: 2000,
      enableOfflineQueue: false,
      autoReconnect: false,
    });
    return client as unknown as SubscriberTransport;
  };
type ObservationSubscriber = ReturnType<typeof createObservationSubscriber>;
