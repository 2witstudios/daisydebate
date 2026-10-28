import {
  ENVELOPE_VERSION,
  observationResourceKey,
  serverMessageSchema,
  type ObservationResource,
  type ServerMessage,
} from '@daisy/protocol';
import type { ObservationHint } from '@daisy/redis';
import type { SocketPrincipal } from '../subscription-state';
import type { Fanout } from './fanout';
import {
  mayEnqueue,
  permitFrom,
  type HeldSnapshot,
  type Permit,
} from './permits';
import { definitionFor, type ObservableResources } from './resources';

/** The socket side of one observing connection. */
export type ObservationConnection = {
  readonly principal: SocketPrincipal;
  /** Sends one already-encoded frame; false when the socket was shed. */
  readonly sendText: (text: string) => boolean;
};
/** Redis-only operations a node uses; it never reads PostgreSQL content. */
export type ObservationNodeCache = {
  readObservation(
    resource: ObservationResource,
    partition: string,
  ): Promise<{
    readonly disclosureRevision: number;
    readonly contentRevision: number;
    readonly body: string;
  } | null>;
  readObservationHeads(
    entries: readonly {
      readonly resource: ObservationResource;
      readonly partition: string;
    }[],
  ): Promise<
    readonly {
      readonly owned: boolean;
      readonly disclosureRevision: number | null;
      readonly contentRevision: number | null;
    }[]
  >;
  refreshObservationInterest(input: {
    readonly node: string;
    readonly resources: readonly ObservationResource[];
    readonly ttlMs: number;
  }): Promise<readonly boolean[]>;
  withdrawObservationInterest(
    resource: ObservationResource,
    node: string,
  ): Promise<void>;
};
export type ObservationNodeBounds = {
  readonly bindingsPerConnection: number;
  readonly bindings: number;
  readonly resources: number;
  /** Encoded snapshot bytes held across every resource. */
  readonly snapshotBytes: number;
};
const defaultObservationNodeBounds: ObservationNodeBounds = {
  bindingsPerConnection: 32,
  bindings: 5_000,
  resources: 1_024,
  snapshotBytes: 64 * 1024 * 1024,
};
/** Permits are renewed this long before they expire (cadence well under 4,700ms). */
const OBSERVATION_RENEW_AHEAD_MS = 2_000;
const OBSERVATION_INTEREST_TTL_MS = 6_000;

type Snapshot = HeldSnapshot & { readonly text: string };
type Binding = {
  readonly connection: ObservationConnection;
  readonly requestId: string;
  readonly generation: number;
  permit: Permit | null;
  lastSent: number | null;
  renewing: boolean;
  /** Whether the client has been told this binding has no valid permit. */
  reportedLapse: boolean;
};
type ResourceState = {
  readonly resource: ObservationResource;
  readonly key: string;
  readonly bindings: Map<ObservationConnection, Binding>;
  /** One held snapshot per partition. */
  readonly snapshots: Map<string, Snapshot>;
  readonly fetching: Map<string, Promise<void>>;
  /** Joins waiting for this tick's one batched admission read. */
  joining: Binding[];
  /** Advanced by every purge: a read or send begun before it delivers nothing. */
  epoch: number;
};

/**
 * One realtime process's observation node (ADR 0089): one interest per
 * resource however many local viewers it has, one body fetch and one
 * encoding per changed revision, permits evaluated in per-resource batches,
 * and a bounded fanout whose every send re-checks the permit synchronously.
 */
export function createObservationNode({
  node,
  now,
  resources: definitions,
  cache,
  subscriber,
  fanout,
  bounds = defaultObservationNodeBounds,
  onError = () => {},
}: {
  /** This process incarnation: interests and claims are per incarnation. */
  readonly node: string;
  /** Monotonic ms. */
  readonly now: () => number;
  readonly resources: ObservableResources;
  readonly cache: ObservationNodeCache;
  readonly subscriber: {
    observe(resource: ObservationResource): Promise<boolean>;
    forget(resource: ObservationResource): Promise<void>;
  };
  readonly fanout: Fanout;
  readonly bounds?: ObservationNodeBounds;
  readonly onError?: (operation: string, error: unknown) => void;
}) {
  const states = new Map<string, ResourceState>();
  const byConnection = new Map<ObservationConnection, Set<ResourceState>>();
  let serving = true;
  let generations = 0;
  let bindingCount = 0;
  let heldBytes = 0;

  const encode = (frame: ServerMessage) =>
    JSON.stringify(serverMessageSchema.parse(frame));
  function sendControl(binding: Binding, frame: ServerMessage) {
    if (serving) binding.connection.sendText(encode(frame));
  }
  const state = (
    s: ResourceState,
    binding: Binding,
    value: 'denied' | 'unavailable' | 'revoked',
  ) =>
    sendControl(binding, {
      v: ENVELOPE_VERSION,
      type: 'observation.state',
      id: binding.requestId,
      resource: s.resource,
      generation: binding.generation,
      state: value,
    });

  function current(s: ResourceState, binding: Binding) {
    return s.bindings.get(binding.connection) === binding && serving;
  }
  function deliverOne(s: ResourceState, binding: Binding, snap: Snapshot) {
    if (
      !current(s, binding) ||
      // A purge or a newer body replaced it while the fanout was yielding.
      s.snapshots.get(snap.partition) !== snap ||
      !mayEnqueue({
        serving,
        generation: binding.generation,
        permit: binding.permit,
        now: now(),
        snapshot: snap,
        lastSent: binding.lastSent,
      })
    )
      return false;
    binding.lastSent = snap.contentRevision;
    return binding.connection.sendText(snap.text);
  }
  async function deliver(s: ResourceState, snap: Snapshot) {
    await fanout(s.bindings.values(), (binding) =>
      deliverOne(s, binding, snap),
    );
  }

  function hold(s: ResourceState, snap: Snapshot) {
    const previous = s.snapshots.get(snap.partition);
    heldBytes += snap.text.length - (previous?.text.length ?? 0);
    s.snapshots.set(snap.partition, snap);
    // Least recently changed resources give up their body first; interest stays.
    states.delete(s.key);
    states.set(s.key, s);
    for (const other of states.values()) {
      if (heldBytes <= bounds.snapshotBytes || other === s) break;
      for (const held of other.snapshots.values())
        heldBytes -= held.text.length;
      other.snapshots.clear();
    }
  }

  /** Fetches the current body for one partition once, however many ask. */
  function fetch(s: ResourceState, partition: string): Promise<void> {
    const pending = s.fetching.get(partition);
    if (pending) return pending;
    const epoch = s.epoch;
    const work = (async () => {
      const stored = await cache.readObservation(s.resource, partition);
      // A body read before a purge is never shown after it.
      if (!stored || states.get(s.key) !== s || s.epoch !== epoch) return;
      const held = s.snapshots.get(partition);
      if (
        held &&
        (held.disclosureRevision > stored.disclosureRevision ||
          (held.disclosureRevision === stored.disclosureRevision &&
            held.contentRevision >= stored.contentRevision))
      )
        return;
      const definition = definitionFor(definitions, s.resource);
      let body: unknown;
      try {
        body = definition?.parseBody(JSON.parse(stored.body)) ?? null;
      } catch {
        body = null;
      }
      if (body === null) return;
      const snap: Snapshot = {
        partition,
        disclosureRevision: stored.disclosureRevision,
        contentRevision: stored.contentRevision,
        text: encode({
          v: ENVELOPE_VERSION,
          type: 'observation.snapshot',
          resource: s.resource,
          partition,
          disclosureRevision: stored.disclosureRevision,
          contentRevision: stored.contentRevision,
          body: body as never,
        }),
      };
      hold(s, snap);
      // A newer disclosure means authority changed: permits of the old base
      // can never receive it, so those viewers are re-admitted now.
      const stale = [...s.bindings.values()].filter(
        (b) =>
          b.permit?.partition === partition &&
          b.permit.disclosureRevision < snap.disclosureRevision,
      );
      if (stale.length > 0)
        void admit(s, stale, 'renewal').catch((error) =>
          onError('observation.permit', error),
        );
      await deliver(s, snap);
    })()
      .catch((error) => onError('observation.fetch', error))
      .finally(() => {
        // Only its own entry: a purge may already have started a fresh fetch.
        if (s.fetching.get(partition) === work) s.fetching.delete(partition);
      });
    s.fetching.set(partition, work);
    return work;
  }

  async function admit(
    s: ResourceState,
    bindings: readonly Binding[],
    lane: 'admission' | 'renewal',
  ) {
    const definition = definitionFor(definitions, s.resource);
    if (!definition) return;
    for (const binding of bindings) binding.renewing = true;
    const readStart = now();
    let decisions: readonly import('./permits').PermitDecision[];
    try {
      decisions = await definition.evaluatePermits({
        id: s.resource.id,
        principals: bindings.map((b) => b.connection.principal),
        lane,
      });
    } catch (error) {
      onError('observation.permit', error);
      decisions = bindings.map(() => ({ status: 'unavailable' as const }));
    }
    const instant = now();
    bindings.forEach((binding, index) => {
      binding.renewing = false;
      if (!current(s, binding)) return;
      const decision = decisions[index] ?? { status: 'unavailable' as const };
      if (decision.status === 'denied') {
        const hadPermit = binding.permit !== null;
        binding.permit = null;
        remove(s, binding);
        state(s, binding, hadPermit ? 'revoked' : 'denied');
        return;
      }
      const permit = permitFrom(decision, {
        readStart,
        generation: binding.generation,
        now: instant,
      });
      if (!permit) {
        // Unavailable is not denial: an unexpired permit stays usable.
        if (binding.permit === null || instant >= binding.permit.expiresAt)
          lapse(s, binding);
        return;
      }
      const rebased =
        binding.permit?.partition !== permit.partition ||
        binding.permit.disclosureRevision !== permit.disclosureRevision;
      binding.permit = permit;
      binding.reportedLapse = false;
      if (rebased) binding.lastSent = null;
      sendControl(binding, {
        v: ENVELOPE_VERSION,
        type: 'observation.ready',
        id: binding.requestId,
        resource: s.resource,
        generation: binding.generation,
        partition: permit.partition,
        disclosureRevision: permit.disclosureRevision,
        minimumContentRevision: permit.minimumContentRevision,
        // Floored: the browser's deadline never outlasts the server permit.
        validForMs: Math.max(1, Math.floor(permit.expiresAt - instant)),
      });
      const held = s.snapshots.get(permit.partition);
      if (
        held &&
        held.disclosureRevision === permit.disclosureRevision &&
        held.contentRevision >= permit.minimumContentRevision
      )
        deliverOne(s, binding, held);
      else void fetch(s, permit.partition);
    });
  }

  function lapse(s: ResourceState, binding: Binding) {
    binding.permit = null;
    if (binding.reportedLapse) return;
    binding.reportedLapse = true;
    state(s, binding, 'unavailable');
  }

  function remove(s: ResourceState, binding: Binding) {
    if (s.bindings.get(binding.connection) !== binding) return;
    s.bindings.delete(binding.connection);
    bindingCount--;
    const mine = byConnection.get(binding.connection);
    mine?.delete(s);
    if (mine?.size === 0) byConnection.delete(binding.connection);
    if (s.bindings.size === 0) release(s);
  }
  function release(s: ResourceState) {
    if (states.get(s.key) !== s) return;
    states.delete(s.key);
    for (const held of s.snapshots.values()) heldBytes -= held.text.length;
    s.snapshots.clear();
    void subscriber
      .forget(s.resource)
      .catch((error) => onError('observation.forget', error));
    void cache
      .withdrawObservationInterest(s.resource, node)
      .catch((error) => onError('observation.withdraw', error));
  }

  return {
    /** Registers one socket's interest; the reply is `ready` or `state`. */
    observe(
      connection: ObservationConnection,
      request: { readonly id: string; readonly resource: ObservationResource },
    ): boolean {
      if (!serving || !definitionFor(definitions, request.resource))
        return false;
      const key = observationResourceKey(request.resource);
      let s = states.get(key);
      const existing = s?.bindings.get(connection);
      const mine = byConnection.get(connection) ?? new Set<ResourceState>();
      if (
        !existing &&
        (bindingCount >= bounds.bindings ||
          mine.size >= bounds.bindingsPerConnection ||
          (!s && states.size >= bounds.resources))
      )
        return false;
      if (!s) {
        s = {
          resource: request.resource,
          key,
          bindings: new Map(),
          snapshots: new Map(),
          fetching: new Map(),
          joining: [],
          epoch: 0,
        };
        states.set(key, s);
        void subscriber
          .observe(request.resource)
          .catch((error) => onError('observation.subscribe', error));
        void cache
          .refreshObservationInterest({
            node,
            resources: [request.resource],
            ttlMs: OBSERVATION_INTEREST_TTL_MS,
          })
          .catch((error) => onError('observation.interest', error));
      }
      const binding: Binding = {
        connection,
        requestId: request.id,
        generation: ++generations,
        permit: null,
        lastSent: null,
        renewing: false,
        reportedLapse: false,
      };
      if (!existing) bindingCount++;
      s.bindings.set(connection, binding);
      mine.add(s);
      byConnection.set(connection, mine);
      // Every join this tick shares one canonical read for the resource.
      s.joining.push(binding);
      if (s.joining.length === 1) {
        const target = s;
        queueMicrotask(() => {
          const batch = target.joining;
          target.joining = [];
          void admit(target, batch, 'admission').catch((error) =>
            onError('observation.permit', error),
          );
        });
      }
      return true;
    },
    unobserve(
      connection: ObservationConnection,
      resource: ObservationResource,
    ) {
      const s = states.get(observationResourceKey(resource));
      const binding = s?.bindings.get(connection);
      if (s && binding) remove(s, binding);
    },
    /** A closed socket drops every binding it held, synchronously. */
    disconnect(connection: ObservationConnection) {
      for (const s of [...(byConnection.get(connection) ?? [])]) {
        const binding = s.bindings.get(connection);
        if (binding) remove(s, binding);
      }
    },
    /** A control fence: every permit of this actor stops now and is re-read. */
    fenceActor(actorId: string) {
      for (const s of states.values()) {
        const affected = [...s.bindings.values()].filter(
          (b) => b.connection.principal.actorId === actorId,
        );
        for (const binding of affected) binding.permit = null;
        if (affected.length > 0)
          void admit(s, affected, 'renewal').catch((error) =>
            onError('observation.permit', error),
          );
      }
    },
    /** A Pub/Sub hint: metadata only; the body is fetched from Redis once. */
    hint(resource: ObservationResource, hint: ObservationHint) {
      const s = states.get(observationResourceKey(resource));
      if (!s) return;
      if (hint.kind === 'purged') {
        s.epoch++;
        for (const held of s.snapshots.values()) heldBytes -= held.text.length;
        s.snapshots.clear();
        s.fetching.clear();
        for (const partition of partitionsOf(s)) void fetch(s, partition);
        return;
      }
      const held = s.snapshots.get(hint.partition);
      if (
        !held ||
        hint.disclosureRevision > held.disclosureRevision ||
        (hint.disclosureRevision === held.disclosureRevision &&
          hint.contentRevision > held.contentRevision)
      )
        void fetch(s, hint.partition);
    },
    /**
     * Redis-only repair, run periodically and after the subscriber
     * resynchronizes: a lost hint costs one head read, never a SQL query.
     * Missing owners re-arm demand through the interest refresh.
     */
    async repair() {
      const entries = [...states.values()].flatMap((s) =>
        partitionsOf(s).map((partition) => ({ s, partition })),
      );
      if (entries.length === 0) return;
      const heads = await cache.readObservationHeads(
        entries.map(({ s, partition }) => ({
          resource: s.resource,
          partition,
        })),
      );
      entries.forEach(({ s, partition }, index) => {
        const head = heads[index];
        if (!head || head.contentRevision === null) return;
        const held = s.snapshots.get(partition);
        if (
          !held ||
          (head.disclosureRevision ?? 0) > held.disclosureRevision ||
          head.contentRevision > held.contentRevision
        )
          void fetch(s, partition);
      });
    },
    /** One batched interest refresh for every local resource. */
    async refreshInterest() {
      const resources = [...states.values()].map((s) => s.resource);
      if (resources.length > 0)
        await cache.refreshObservationInterest({
          node,
          resources,
          ttlMs: OBSERVATION_INTEREST_TTL_MS,
        });
    },
    /** Renews permits nearing expiry, one batch per resource; reports lapses. */
    renew() {
      const instant = now();
      for (const s of states.values()) {
        const due: Binding[] = [];
        for (const binding of s.bindings.values()) {
          if (binding.permit && instant >= binding.permit.expiresAt)
            lapse(s, binding);
          if (
            !binding.renewing &&
            (binding.permit === null ||
              binding.permit.expiresAt - instant <= OBSERVATION_RENEW_AHEAD_MS)
          )
            due.push(binding);
        }
        if (due.length > 0)
          void admit(s, due, 'renewal').catch((error) =>
            onError('observation.permit', error),
          );
      }
    },
    /** Stops every enqueue at once; restart is a new node incarnation. */
    close() {
      serving = false;
      for (const s of [...states.values()]) release(s);
      byConnection.clear();
      bindingCount = 0;
    },
    stats: () => ({
      resources: states.size,
      bindings: bindingCount,
      heldBytes,
    }),
  };
}
const partitionsOf = (s: ResourceState) => [
  ...new Set(
    [...s.bindings.values()].flatMap((b) =>
      b.permit ? [b.permit.partition] : [],
    ),
  ),
];
export type ObservationNode = ReturnType<typeof createObservationNode>;
