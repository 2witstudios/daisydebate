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
type Interest = {
  readonly resource: ObservationResource;
  readonly listeners: Set<() => void>;
  readonly handler: Listener;
  subscribedGeneration: number;
};
/** One native subscriber per process. Reconnect subscribes and repairs the
 * complete bounded interest set before declaring synchronization restored.
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
  const client = createClient(),
    interests = new Map<string, Interest>();
  const channelJobs = new Map<string, Promise<void>>();
  const cleanup = new Set<string>();
  function channelWork(channel: string, operation: () => Promise<unknown>) {
    const prior = channelJobs.get(channel) ?? Promise.resolve();
    const job = prior
      .catch(() => {})
      .then(async () => {
        if (!closed) await operation();
      })
      .finally(() => {
        if (channelJobs.get(channel) === job) channelJobs.delete(channel);
      });
    channelJobs.set(channel, job);
    return job;
  }
  async function removeChannel(channel: string) {
    cleanup.add(channel);
    await channelWork(channel, async () => {
      if (!interests.has(channel)) await client.unsubscribe(channel);
      cleanup.delete(channel);
    });
  }
  let closed = false,
    synchronized = false,
    generation = 0,
    membership = 0;
  let work: Promise<void> | undefined;
  const notify = (entry: Interest) => {
    for (const listener of entry.listeners) {
      try {
        listener();
      } catch {
        /* One reader cannot disrupt head repair. */
      }
    }
  };
  function reconnect(): Promise<void> {
    if (closed) return Promise.resolve();
    if (work) return work;
    const attempt = ++generation;
    synchronized = false;
    work = Promise.resolve()
      .then(async () => {
        await client.connect();
        for (const channel of cleanup) await removeChannel(channel);
        for (let pass = 0; pass < 4; pass++) {
          if (closed || attempt !== generation) return;
          const version = membership;
          for (const [channel, entry] of interests) {
            if (entry.subscribedGeneration === attempt) continue;
            await channelWork(channel, async () => {
              if (interests.get(channel) === entry)
                await client.subscribe(channel, entry.handler);
            });
            if (closed || attempt !== generation) return;
            if (interests.get(channel) === entry)
              entry.subscribedGeneration = attempt;
          }
          await reconcile(
            [...interests.values()].map((entry) => entry.resource),
          );
          if (closed || attempt !== generation) return;
          if (version !== membership) continue;
          synchronized = true;
          for (const entry of interests.values()) notify(entry);
          return;
        }
        // Continuous churn stays degraded. Periodic repair retries bounded work.
      })
      .finally(() => {
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
      let entry = interests.get(channel),
        created = false;
      const registration = () => listener();
      if (!entry) {
        if (interests.size + channelJobs.size + cleanup.size >= 1024)
          throw new Error('Observation interest capacity exceeded');
        const listeners = new Set<() => void>();
        entry = {
          resource,
          listeners,
          handler: () => {
            const current = interests.get(channel);
            if (current) notify(current);
          },
          subscribedGeneration: -1,
        };
        interests.set(channel, entry);
        membership++;
        created = true;
      }
      const current = entry;
      current.listeners.add(registration);
      try {
        if (created || !synchronized) await reconnect();
        else registration();
      } catch (error) {
        current.listeners.delete(registration);
        if (!current.listeners.size && interests.get(channel) === current) {
          interests.delete(channel);
          membership++;
          synchronized = false;
          await removeChannel(channel).catch(() => {
            synchronized = false;
          });
        }
        throw error;
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        current.listeners.delete(registration);
        if (current.listeners.size || interests.get(channel) !== current)
          return;
        interests.delete(channel);
        membership++;
        void removeChannel(channel).catch(() => {
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
      // Bun 1.4.2 cannot safely clear onclose before native close; callbacks are fenced.
      client.close();
      await work;
      await Promise.allSettled([...channelJobs.values()]);
    },
  };
}
