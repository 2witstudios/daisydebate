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
type Ready = Extract<ObservationServerMessage, { type: 'observation.ready' }>;
type Snapshot = Extract<
  ObservationServerMessage,
  { type: 'observation.snapshot' }
>;
type State = Extract<ObservationServerMessage, { type: 'observation.state' }>;
type Entry = {
  readonly descriptor: Descriptor;
  readonly listeners: Set<Listener>;
  id: string;
  ready: Ready | null;
  snapshot: Snapshot | null;
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
  const sameResource = (entry: Entry, resource: ObservationResource) =>
    resource.kind === entry.descriptor.resource.kind &&
    resource.id === entry.descriptor.resource.id;
  function ready(entry: Entry, frame: Ready) {
    if (
      !sameResource(entry, frame.base.resource) ||
      frame.base.window.after !== entry.descriptor.window.after ||
      frame.base.window.limit !== entry.descriptor.window.limit
    )
      return false;
    // Replayed to later listeners: keep the generation's overlay when omitted.
    const previous = entry.ready;
    entry.ready =
      frame.overlay === undefined &&
      previous?.generation === frame.generation &&
      previous.overlay !== undefined
        ? { ...frame, overlay: previous.overlay }
        : frame;
    entry.generation = frame.generation;
    entry.expiresAt = now() + frame.validForMs;
    entry.snapshot = null;
    return true;
  }
  function snapshot(entry: Entry, frame: Snapshot) {
    if (
      !entry.ready ||
      frame.generation !== entry.generation ||
      observationBaseKey(frame.base) !== observationBaseKey(entry.ready.base) ||
      frame.contentRevision < entry.ready.minimumContentRevision ||
      frame.contentRevision <= (entry.snapshot?.contentRevision ?? -1)
    )
      return false;
    entry.snapshot = frame;
    return true;
  }
  function state(entry: Entry, frame: State) {
    if (!sameResource(entry, frame.resource)) return false;
    entry.generation = frame.generation;
    if (frame.state !== 'degraded') {
      entry.ready = null;
      entry.snapshot = null;
    }
    return true;
  }
  return {
    observe(descriptor: Descriptor, listener: Listener) {
      if (disposed) throw new Error('Observation subscriptions disposed');
      observationResourceSchema.parse(descriptor.resource, { jitless: true });
      observationWindowSchema.parse(descriptor.window, { jitless: true });
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
      if (!entry || disposed || frame.generation < entry.generation) return;
      const accepted =
        frame.type === 'observation.ready'
          ? ready(entry, frame)
          : frame.type === 'observation.snapshot'
            ? snapshot(entry, frame)
            : state(entry, frame);
      if (accepted) notify(entry.listeners, frame);
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
