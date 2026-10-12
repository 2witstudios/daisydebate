import {
  observationDescriptorSchema,
  observationBaseKey,
  type ObservationDescriptor,
  type ObservationServerMessage,
} from '@daisy/protocol';
import type { ConnectionStore, Scheduler } from './connection-store';
import {
  createObservationStore,
  type ObservationState,
} from './observation-store';
export type RealtimeDescriptor<T> = ObservationDescriptor & {
  readonly schema: string;
  readonly decode: (body: unknown) => T | null;
};
type Store = ReturnType<typeof createObservationStore<unknown>>;
type Interest = {
  readonly descriptor: RealtimeDescriptor<unknown>;
  readonly store: Store;
  release: () => void;
  refs: number;
  attempt: number;
  generation: number;
  requestId: string | null;
  expiresAt: number;
  timer: unknown;
  /** The overlay the server last sent for this request generation. */
  overlay: unknown;
};
/** One tab/session composition owns transport, deadlines and replaceable views.
 * Features supply a schema-bound descriptor, never refetch or repair callbacks.
 */
export function createObservationProvider({
  connection,
  scheduler,
}: {
  readonly connection: Pick<
    ConnectionStore,
    'connect' | 'dispose' | 'observe' | 'subscribe'
  >;
  readonly scheduler: Scheduler;
}) {
  const interests = new Map<string, Interest>();
  let disposed = false,
    connected = false,
    transportAvailable = true;
  function clearTimer(entry: Interest) {
    if (entry.timer !== null) scheduler.clearTimeout(entry.timer);
    entry.timer = null;
  }
  function expired(entry: Interest) {
    if (scheduler.now() < entry.expiresAt) return false;
    clearTimer(entry);
    if (entry.store.read().status !== 'unavailable') entry.store.unavailable();
    return true;
  }
  function receive(entry: Interest, frame: ObservationServerMessage) {
    if (disposed || !transportAvailable) return;
    // A new correlated request replaces the previous one; hide until it is ready.
    if (frame.type === 'observation.ready' && frame.id !== entry.requestId) {
      clearTimer(entry);
      entry.store.unavailable();
      entry.generation = -1;
      entry.requestId = frame.id;
    }
    if (frame.id !== entry.requestId || frame.generation < entry.generation)
      return;
    if (frame.type === 'observation.ready') ready(entry, frame);
    else if (frame.type === 'observation.snapshot') snapshot(entry, frame);
    else state(entry, frame);
  }
  function ready(
    entry: Interest,
    frame: Extract<ObservationServerMessage, { type: 'observation.ready' }>,
  ) {
    clearTimer(entry);
    // An omitted overlay is unchanged within a generation; a new one starts empty.
    if (frame.overlay !== undefined) entry.overlay = frame.overlay;
    else if (frame.generation !== entry.generation) entry.overlay = null;
    entry.generation = frame.generation;
    entry.expiresAt = scheduler.now() + frame.validForMs;
    entry.attempt = entry.store.begin();
    entry.store.authorize(
      entry.attempt,
      {
        partition: observationBaseKey(frame.base),
        disclosureRevision: frame.base.disclosureRevision,
      },
      entry.overlay,
    );
    if (disposed || entry.store.read().status === 'disposed') return;
    entry.timer = scheduler.setTimeout(() => {
      expired(entry);
    }, frame.validForMs);
  }
  function snapshot(
    entry: Interest,
    frame: Extract<ObservationServerMessage, { type: 'observation.snapshot' }>,
  ) {
    if (frame.generation !== entry.generation || expired(entry)) return;
    entry.store.snapshot(entry.attempt, {
      partition: observationBaseKey(frame.base),
      disclosureRevision: frame.base.disclosureRevision,
      contentRevision: frame.contentRevision,
      body: frame.body,
    });
  }
  function state(
    entry: Interest,
    frame: Extract<ObservationServerMessage, { type: 'observation.state' }>,
  ) {
    entry.generation = frame.generation;
    if (frame.state === 'degraded') {
      if (!expired(entry)) entry.store.dirty();
      return;
    }
    clearTimer(entry);
    if (frame.state === 'denied') entry.store.deny();
    else entry.store.unavailable();
  }
  const releaseConnection = connection.subscribe((state) => {
    transportAvailable = state.status === 'open';
    if (state.status === 'closed' || state.status === 'connecting')
      for (const entry of interests.values()) {
        clearTimer(entry);
        entry.store.unavailable();
      }
    if (state.terminal !== null)
      for (const entry of interests.values()) {
        clearTimer(entry);
        entry.store.deny();
      }
  });
  return {
    observe<T>(descriptor: RealtimeDescriptor<T>) {
      if (disposed) throw new Error('Observation provider disposed');
      const parsed = observationDescriptorSchema.parse({
        resource: descriptor.resource,
        window: descriptor.window,
      });
      const key = JSON.stringify([
        parsed.resource.kind,
        parsed.resource.id,
        parsed.window.after,
        parsed.window.limit,
      ]);
      let entry = interests.get(key);
      if (entry && entry.descriptor.schema !== descriptor.schema)
        throw new Error('Conflicting observation schema');
      if (!entry) {
        if (interests.size >= 128)
          throw new Error('Observation tab capacity exceeded');
        entry = {
          descriptor,
          store: createObservationStore({ decode: descriptor.decode }),
          release: () => {},
          refs: 0,
          attempt: 0,
          generation: -1,
          requestId: null,
          expiresAt: 0,
          timer: null,
          overlay: null,
        };
        interests.set(key, entry);
        const owned = entry;
        entry.release = connection.observe(parsed, (frame) => {
          if (interests.get(key) === owned) receive(owned, frame);
        });
      }
      const current = entry;
      current.refs++;
      if (!connected) {
        connected = true;
        connection.connect();
      }
      let released = false;
      return {
        read: () => {
          if (
            current.expiresAt > 0 &&
            current.store.read().status !== 'denied' &&
            current.store.read().status !== 'disposed'
          )
            expired(current);
          return current.store.read() as ObservationState<T>;
        },
        subscribe: current.store.subscribe,
        close() {
          if (released) return;
          released = true;
          current.refs--;
          if (current.refs || interests.get(key) !== current) return;
          interests.delete(key);
          clearTimer(current);
          current.release();
          current.store.dispose();
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseConnection();
      for (const entry of interests.values()) {
        clearTimer(entry);
        entry.release();
        entry.store.dispose();
      }
      interests.clear();
      connection.dispose();
    },
  };
}
