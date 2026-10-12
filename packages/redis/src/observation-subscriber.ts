import {
  observationResourceKey,
  type ObservationResource,
} from '@daisy/protocol';
import { redisKey } from './redis-key';

type Listener = (message: string, channel: string) => void;
export type ObservationSubscriberTransport = {
  onconnect?: (() => void) | null | undefined;
  onclose?: ((error: Error) => void) | null | undefined;
  readonly connect: () => Promise<unknown>;
  readonly subscribe: (channel: string, listener: Listener) => Promise<unknown>;
  readonly unsubscribe: (channel: string) => Promise<unknown>;
  readonly close: () => void;
};
/** One additional native connection per process, never one per resource/socket.
 * At-most-once hints accelerate reads only; reconnect repairs every interested
 * head before synchronization becomes ready.
 */
export function createObservationSubscriber({
  namespace,
  createClient,
  reconcile,
}: {
  readonly namespace: string;
  readonly createClient: () => ObservationSubscriberTransport;
  readonly reconcile: (
    resources: readonly ObservationResource[],
  ) => Promise<void>;
}) {
  const client = createClient();
  const interests = new Map<
    string,
    {
      resource: ObservationResource;
      listeners: Set<() => void>;
      handler: Listener;
    }
  >();
  let closed = false,
    synchronized = false,
    generation = 0;
  let work: Promise<void> | undefined;
  function reconnect(): Promise<void> {
    if (closed) return Promise.resolve();
    if (work) return work;
    const attempt = ++generation;
    synchronized = false;
    work = (async () => {
      await client.connect();
      if (closed || attempt !== generation) return;
      for (const [channel, entry] of interests) {
        await client.subscribe(channel, entry.handler);
        if (closed || attempt !== generation) return;
      }
      await reconcile([...interests.values()].map((entry) => entry.resource));
      if (!closed && attempt === generation) synchronized = true;
    })().finally(() => {
      work = undefined;
    });
    return work;
  }
  client.onclose = () => {
    generation++;
    synchronized = false;
  };
  client.onconnect = () => {
    if (!work)
      void reconnect().catch(() => {
        synchronized = false;
      });
  };
  return {
    ready: () => synchronized && !closed,
    reconnect,
    async interest(resource: ObservationResource, listener: () => void) {
      if (closed) throw new Error('Observation subscriber disposed');
      const channel = redisKey(
        namespace,
        'observation',
        observationResourceKey(resource),
        'hint',
      );
      let entry = interests.get(channel);
      if (!entry) {
        if (interests.size >= 1024)
          throw new Error('Observation interest capacity exceeded');
        const listeners = new Set<() => void>();
        entry = {
          resource,
          listeners,
          handler: () => {
            for (const notify of listeners) {
              try {
                notify();
              } catch {
                /* A consumer cannot disrupt repair. */
              }
            }
          },
        };
        interests.set(channel, entry);
        if (synchronized) {
          await client.subscribe(channel, entry.handler);
          await reconcile([resource]);
        } else await reconnect();
      }
      const current = entry;
      current.listeners.add(listener);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        current.listeners.delete(listener);
        if (current.listeners.size || interests.get(channel) !== current)
          return;
        interests.delete(channel);
        void client.unsubscribe(channel).catch(() => {
          synchronized = false;
        });
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      synchronized = false;
      generation++;
      interests.clear();
      client.close();
      await work;
    },
  };
}
