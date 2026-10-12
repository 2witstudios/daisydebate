import {
  ENVELOPE_VERSION,
  observationResourceSchema,
  observationWindowSchema,
  observationBaseKey,
  type ObservationResource,
  type ObservationServerMessage,
} from '@daisy/protocol';
type Descriptor = {
  readonly resource: ObservationResource;
  readonly window: {
    readonly after: string | number | null;
    readonly limit: number;
  };
};
type Listener = (frame: ObservationServerMessage) => void;
type Entry = {
  readonly descriptor: Descriptor;
  readonly listeners: Set<Listener>;
  id: string;
  ready: Extract<
    ObservationServerMessage,
    { type: 'observation.ready' }
  > | null;
  snapshot: Extract<
    ObservationServerMessage,
    { type: 'observation.snapshot' }
  > | null;
  generation: number;
  expiresAt: number;
};
const keyFor = (descriptor: Descriptor) =>
  JSON.stringify([
    descriptor.resource.kind,
    descriptor.resource.id,
    descriptor.window.after,
    descriptor.window.limit,
  ]);
/** Correlation and ref-counting belong to the tab transport, not feature code. */
export function createObservationSubscriptions({
  send,
  now,
}: {
  readonly send: (frame: object) => void;
  readonly now: () => number;
}) {
  const entries = new Map<string, Entry>(),
    requests = new Map<string, Entry>();
  let counter = 0,
    disposed = false;
  function request(entry: Entry, type: 'observe' | 'unobserve') {
    requests.delete(entry.id);
    entry.id = `observe-${++counter}`;
    requests.set(entry.id, entry);
    send({ v: ENVELOPE_VERSION, type, id: entry.id, ...entry.descriptor });
  }
  const notify = (
    listeners: Iterable<Listener>,
    frame: ObservationServerMessage,
  ) => {
    for (const listener of listeners) {
      try {
        listener(frame);
      } catch {
        /* A renderer cannot disrupt the shared transport. */
      }
    }
  };
  return {
    observe(descriptor: Descriptor, listener: Listener) {
      if (disposed) throw new Error('Observation subscriptions disposed');
      observationResourceSchema.parse(descriptor.resource);
      observationWindowSchema.parse(descriptor.window);
      const key = keyFor(descriptor);
      let entry = entries.get(key);
      const registration: Listener = (frame) => listener(frame);
      if (!entry) {
        if (entries.size >= 128)
          throw new Error('Observation tab capacity exceeded');
        entry = {
          descriptor,
          listeners: new Set(),
          id: '',
          ready: null,
          snapshot: null,
          generation: -1,
          expiresAt: 0,
        };
        entries.set(key, entry);
        entry.listeners.add(registration);
        request(entry, 'observe');
      } else {
        entry.listeners.add(registration);
        if (entry.ready && now() < entry.expiresAt) {
          notify([registration], {
            ...entry.ready,
            validForMs: Math.max(1, Math.floor(entry.expiresAt - now())),
          });
          if (entry.snapshot) notify([registration], entry.snapshot);
        }
      }
      const current = entry;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        current.listeners.delete(registration);
        if (current.listeners.size || entries.get(key) !== current) return;
        request(current, 'unobserve');
        requests.delete(current.id);
        entries.delete(key);
      };
    },
    emit(frame: ObservationServerMessage) {
      const entry = requests.get(frame.id);
      if (!entry || disposed) return;
      if (frame.generation < entry.generation) return;
      if (frame.type === 'observation.ready') {
        if (
          frame.base.resource.kind !== entry.descriptor.resource.kind ||
          frame.base.resource.id !== entry.descriptor.resource.id ||
          frame.base.window.after !== entry.descriptor.window.after ||
          frame.base.window.limit !== entry.descriptor.window.limit
        )
          return;
        entry.generation = frame.generation;
        entry.expiresAt = now() + frame.validForMs;
        entry.ready = frame;
        entry.snapshot = null;
      } else if (frame.type === 'observation.snapshot') {
        if (
          !entry.ready ||
          frame.generation !== entry.generation ||
          observationBaseKey(frame.base) !==
            observationBaseKey(entry.ready.base) ||
          frame.contentRevision < entry.ready.minimumContentRevision ||
          frame.contentRevision <= (entry.snapshot?.contentRevision ?? -1)
        )
          return;
        entry.snapshot = frame;
      } else {
        if (
          frame.resource.kind !== entry.descriptor.resource.kind ||
          frame.resource.id !== entry.descriptor.resource.id
        )
          return;
        entry.generation = frame.generation;
        if (frame.state !== 'degraded') {
          entry.ready = null;
          entry.snapshot = null;
        }
      }
      notify(entry.listeners, frame);
    },
    reconnect() {
      if (disposed) return;
      for (const entry of entries.values()) {
        entry.ready = null;
        entry.snapshot = null;
        entry.generation = -1;
        request(entry, 'observe');
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      entries.clear();
      requests.clear();
    },
  };
}
