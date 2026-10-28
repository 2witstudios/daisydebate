import {
  observationResourceKey,
  type ObservationResource,
  type ServerMessage,
} from '@daisy/protocol';
import type { ConnectionStore, Scheduler } from './connection-types';

/**
 * What a feature declares to observe one shared resource (ADR 0089): the
 * resource, how to validate its body, and the content revision a body
 * carries. Feature code never supplies retries, refetches or resubscribes.
 */
export type ObservationDescriptor<Body> = {
  readonly resource: ObservationResource;
  readonly parse: (body: unknown) => Body | null;
  readonly revisionOf: (body: Body) => number;
};
/**
 * - `pending`: no permit yet; the server-rendered body (if any) stays.
 * - `live`: a permit is current; snapshots apply.
 * - `degraded`: renewal or the socket is unavailable; content stays until the permit deadline.
 * - `hidden`: denied, revoked or expired; protected content is withdrawn.
 */
export type ObservationStatus = 'pending' | 'live' | 'degraded' | 'hidden';
export type ObservationView<Body> = {
  readonly status: ObservationStatus;
  readonly body: Body | null;
};

type Entry = {
  readonly resource: ObservationResource;
  readonly descriptor: ObservationDescriptor<unknown>;
  readonly listeners: Set<() => void>;
  requestId: string;
  generation: number;
  base: {
    readonly partition: string;
    readonly disclosureRevision: number;
  } | null;
  deadline: number | null;
  timer: unknown;
  view: ObservationView<unknown>;
  revision: number;
};

/**
 * One tab's observation provider: one interest per resource however many
 * components read it, monotonic snapshot application within the current
 * permit's base, permit deadlines enforced locally, and recovery by
 * re-observing on every socket `ready`. Disposal is final and idempotent.
 */
export function createObservationProvider({
  connection,
  scheduler,
  nextId,
}: {
  readonly connection: ConnectionStore;
  readonly scheduler: Scheduler;
  readonly nextId: () => string;
}) {
  const entries = new Map<string, Entry>();
  let disposed = false;

  const notify = (entry: Entry) => {
    for (const listener of [...entry.listeners]) listener();
  };
  const set = (entry: Entry, view: ObservationView<unknown>) => {
    entry.view = view;
    notify(entry);
  };
  const hide = (entry: Entry) => {
    clearDeadline(entry);
    entry.base = null;
    set(entry, { status: 'hidden', body: null });
  };
  function clearDeadline(entry: Entry) {
    if (entry.timer !== null) scheduler.clearTimeout(entry.timer);
    entry.timer = null;
    entry.deadline = null;
  }
  function armDeadline(entry: Entry, validForMs: number) {
    clearDeadline(entry);
    entry.deadline = scheduler.now() + validForMs;
    entry.timer = scheduler.setTimeout(() => {
      entry.timer = null;
      // Expired permission hides protected content (repair plan §4).
      if (entry.deadline !== null && scheduler.now() >= entry.deadline)
        hide(entry);
    }, validForMs);
  }
  const send = (entry: Entry) =>
    connection.sendObservation({
      type: 'observe',
      id: entry.requestId,
      resource: entry.resource,
    });

  function receive(frame: ServerMessage) {
    if (
      frame.type !== 'observation.ready' &&
      frame.type !== 'observation.snapshot' &&
      frame.type !== 'observation.state'
    )
      return;
    const entry = entries.get(observationResourceKey(frame.resource));
    if (!entry) return;
    if (frame.type === 'observation.snapshot') {
      if (
        entry.base?.partition !== frame.partition ||
        entry.base.disclosureRevision !== frame.disclosureRevision ||
        entry.deadline === null ||
        scheduler.now() >= entry.deadline
      )
        return;
      const body = entry.descriptor.parse(frame.body);
      if (body === null) return;
      const revision = entry.descriptor.revisionOf(body);
      if (revision <= entry.revision && entry.view.body !== null) return;
      entry.revision = revision;
      set(entry, { status: 'live', body });
      return;
    }
    // ready and state are request-bound: only the latest request's generation counts.
    if (frame.id !== undefined && frame.id !== entry.requestId) return;
    if (frame.generation < entry.generation) return;
    entry.generation = frame.generation;
    if (frame.type === 'observation.ready') {
      entry.base = {
        partition: frame.partition,
        disclosureRevision: frame.disclosureRevision,
      };
      armDeadline(entry, frame.validForMs);
      if (entry.view.status !== 'live')
        set(entry, { status: 'live', body: entry.view.body });
      return;
    }
    if (frame.state === 'denied' || frame.state === 'revoked') hide(entry);
    else if (entry.view.status !== 'hidden')
      set(entry, { status: 'degraded', body: entry.view.body });
  }

  const stopMessages = connection.onMessage(receive);
  const stopState = connection.subscribe((state) => {
    if (disposed) return;
    if (state.status === 'open')
      for (const entry of entries.values()) {
        // A fresh socket gets fresh requests: older answers are fenced out,
        // and the serving node numbers its generations afresh.
        entry.requestId = nextId();
        entry.generation = 0;
        send(entry);
      }
    else
      for (const entry of entries.values())
        if (entry.view.status === 'live')
          set(entry, { status: 'degraded', body: entry.view.body });
  });

  return {
    /**
     * Holds one reference to `descriptor`'s resource. `initial` is the
     * server-rendered body: useful display, never a live permission.
     */
    observe<Body>(
      descriptor: ObservationDescriptor<Body>,
      initial: Body | null,
      listener: () => void,
    ): {
      readonly view: () => ObservationView<Body>;
      readonly release: () => void;
    } {
      const key = observationResourceKey(descriptor.resource);
      let entry = entries.get(key);
      if (!entry && !disposed) {
        entry = {
          resource: descriptor.resource,
          descriptor: descriptor as ObservationDescriptor<unknown>,
          listeners: new Set(),
          requestId: nextId(),
          generation: 0,
          base: null,
          deadline: null,
          timer: null,
          view: { status: 'pending', body: initial },
          revision: initial === null ? -1 : descriptor.revisionOf(initial),
        };
        entries.set(key, entry);
        send(entry);
      }
      const held = entry;
      held?.listeners.add(listener);
      let released = false;
      return {
        view: () =>
          (held?.view ?? {
            status: 'pending',
            body: initial,
          }) as ObservationView<Body>,
        release() {
          if (released || !held) return;
          released = true;
          held.listeners.delete(listener);
          if (held.listeners.size > 0 || entries.get(key) !== held) return;
          entries.delete(key);
          clearDeadline(held);
          connection.sendObservation({
            type: 'unobserve',
            id: nextId(),
            resource: held.resource,
          });
        },
      };
    },
    /** Final: unobserves everything, releases every listener and timer. */
    dispose() {
      if (disposed) return;
      disposed = true;
      stopMessages();
      stopState();
      for (const entry of entries.values()) {
        clearDeadline(entry);
        entry.listeners.clear();
        connection.sendObservation({
          type: 'unobserve',
          id: nextId(),
          resource: entry.resource,
        });
      }
      entries.clear();
    },
    size: () => entries.size,
  };
}
export type ObservationProvider = ReturnType<typeof createObservationProvider>;
