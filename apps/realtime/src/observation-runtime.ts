import {
  ENVELOPE_VERSION,
  createObservationChannelBody,
  observationResourceKey,
  type MessagingCoreBounds,
  type ObservationBase,
  type ObservationHeader,
  type ObservationResource,
} from '@daisy/protocol';
import type { Database } from '@daisy/db';
import type { RealtimeApp } from './app';
import { createObservationNode } from './observation-node';
import { createObservationSessions } from './observation-sessions';
import { createObservationWorker } from './observation-worker';
import { createObservationDiscovery } from './observation-discovery';
import type { createObservationAuthorityReader } from './observation-authority';
import type { IntervalTimers } from './outbox-drain';

type Redis = RealtimeApp['redis'];
type Projection = Pick<
  Database,
  'readObservationHeaders' | 'readObservationProjection'
>;
const ownerReconcileMs = 100,
  discoveryMs = 250,
  repairMs = 500,
  renewalTickMs = 500,
  bodyTtlMs = 60_000,
  claimTtlMs = 2000;

/** Portable bodies adopted by this runtime; other kinds stay unavailable
 * until their projection producer and consumer are both ready. */
function bodyBuilder(channelBounds: MessagingCoreBounds | undefined) {
  const channel = channelBounds && createObservationChannelBody(channelBounds);
  return {
    supports: (resource: ObservationResource) =>
      resource.kind === 'channel' && channel !== undefined,
    build(
      projection: Awaited<ReturnType<Projection['readObservationProjection']>>,
    ) {
      const mapped =
        projection.base.resource.kind === 'channel' && channel
          ? channel.fromProjection(projection)
          : { status: 'unavailable' as const };
      if (mapped.status !== 'ready')
        throw new Error('Observation body unavailable');
      return JSON.stringify(mapped.body);
    },
  };
}

/** Composes one node's observation roles. Fanout-only nodes perform Redis
 * work and local gates; only an eligible process with the projection
 * allocation reads headers and builds shared bodies.
 */
export function createObservationRuntime({
  nodeIncarnation,
  now,
  timers,
  redis,
  authority,
  projection,
  channelBounds,
  maxPerSession,
  nextToken,
  yieldWork = () => new Promise((resolve) => setImmediate(resolve)),
}: {
  readonly nodeIncarnation: string;
  readonly now: () => number;
  readonly timers: IntervalTimers;
  readonly redis: Redis;
  readonly authority: ReturnType<typeof createObservationAuthorityReader>;
  readonly projection?: Projection;
  readonly channelBounds?: MessagingCoreBounds;
  readonly maxPerSession: number;
  readonly nextToken: () => string;
  readonly yieldWork?: () => Promise<void>;
}) {
  const bodies = bodyBuilder(channelBounds);
  let cacheIncarnation: string | null = null,
    closed = false;
  const node = createObservationNode({
    nodeIncarnation,
    now,
    yieldWork,
    cache: {
      demand: async (base) => {
        await redis.demandObservation(base.resource, nodeIncarnation, [base]);
      },
      read: async (base) => {
        if (cacheIncarnation === null) return null;
        const [entry] = await redis.readObservations(
          base.resource,
          cacheIncarnation,
          [base],
        );
        return entry ? { base, ...entry } : null;
      },
    },
  });
  const subscriber = redis.observationSubscriber(async (resources) => {
    for (const resource of resources)
      await node.repair(observationResourceKey(resource));
  });
  const interests = new Map<
    string,
    { count: number; release: Promise<(() => void) | null> }
  >();
  function interest(resource: ObservationResource) {
    const key = observationResourceKey(resource);
    let entry = interests.get(key);
    if (!entry) {
      entry = {
        count: 0,
        release: subscriber
          .interest(resource, () => void node.repair(key).catch(() => {}))
          .catch(() => null),
      };
      interests.set(key, entry);
    }
    entry.count++;
    const current = entry;
    return () => {
      if (--current.count || interests.get(key) !== current) return;
      interests.delete(key);
      void current.release.then((release) => release?.());
    };
  }
  const sessions = createObservationSessions({
    now,
    nodeIncarnation,
    authority,
    maxPerSession,
    node: {
      observe(base, permit, send) {
        const releaseInterest = interest(base.resource);
        const keys = node.stats().keys;
        const release = node.observe(base, permit, send);
        // Only a new local key needs demand and a head read; joiners of an
        // existing key receive its current snapshot from local fanout.
        if (node.stats().keys > keys)
          void node
            .repair(observationResourceKey(base.resource))
            .catch(() => {});
        return () => {
          release();
          releaseInterest();
        };
      },
    },
  });
  const worker =
    projection &&
    createObservationWorker({
      eligible: true,
      now,
      nextToken,
      readHeaders: (resources, isCurrent) =>
        projection.readObservationHeaders(resources, { isCurrent }),
      build: async (base, header, isCurrent) => {
        const result = await projection.readObservationProjection({
          isCurrent,
          base,
          minimumContentRevision: header.contentRevision,
          purgeGeneration: header.purgeGeneration,
        });
        return { header: result.header, body: bodies.build(result) };
      },
      cache: workerCache(redis, () => cacheIncarnation),
    });
  const discovery =
    worker &&
    createObservationDiscovery({
      eligible: true,
      cache: {
        discover: (limit) => redis.discoverObservations(limit),
        readDemand: (resource) => redis.readObservationDemand(resource),
      },
      worker,
    });
  /** A changed cache incarnation means Redis lost its state: re-claim everything. */
  async function establish() {
    const current = await redis.establishObservationIncarnation(nextToken());
    if (cacheIncarnation !== null && current !== cacheIncarnation)
      discovery?.uncertain();
    cacheIncarnation = current;
  }
  const loops: ReturnType<typeof setInterval>[] = [];
  const every = (ms: number, work: () => Promise<void> | void) =>
    loops.push(
      timers.setInterval(() => {
        if (!closed) void Promise.resolve(work()).catch(() => {});
      }, ms),
    );
  return {
    async start() {
      await establish();
      every(renewalTickMs, () => sessions.renewDue());
      every(repairMs, async () => {
        await establish();
        await node.repair();
      });
      if (worker && discovery) {
        every(ownerReconcileMs, () => worker.reconcile());
        every(discoveryMs, () => discovery.reconcile());
      }
    },
    /** Socket edge: kinds without an adopted producer are unavailable, never denied. */
    connect(...args: Parameters<typeof sessions.connect>) {
      const connection = sessions.connect(...args);
      const [, outbound] = args;
      return {
        ...connection,
        observe(request: Parameters<typeof connection.observe>[0]) {
          if (bodies.supports(request.resource))
            return connection.observe(request);
          outbound.send({
            v: ENVELOPE_VERSION,
            type: 'observation.state',
            id: request.id,
            generation: 0,
            resource: request.resource,
            state: 'unavailable',
          });
        },
      };
    },
    invalidate: (dependencyKey: string) => sessions.invalidate(dependencyKey),
    stats: () => ({ node: node.stats(), sessions: sessions.stats() }),
    async close() {
      if (closed) return;
      closed = true;
      for (const loop of loops) timers.clearInterval(loop);
      sessions.close();
      node.close();
      discovery?.close();
      await worker?.close();
      await subscriber.close();
      await node.settled();
    },
  };
}
function workerCache(redis: Redis, incarnation: () => string | null) {
  const current = () => {
    const value = incarnation();
    if (value === null)
      throw new Error('Observation cache incarnation unknown');
    return value;
  };
  return {
    claim: (resource: ObservationResource, token: string) =>
      redis.claimObservation({
        resource,
        incarnation: current(),
        token,
        ttlMs: claimTtlMs,
      }),
    release: async (resource: ObservationResource, token: string) => {
      await redis.releaseObservation(resource, token);
    },
    prepare: (header: ObservationHeader, token: string) =>
      redis.prepareObservation({
        resource: header.resource,
        incarnation: current(),
        token,
        purgeGeneration: header.purgeGeneration,
        disclosureRevision: header.disclosureRevision,
      }),
    ready: (base: ObservationBase, header: ObservationHeader, token: string) =>
      redis.retainObservation({
        resource: header.resource,
        incarnation: current(),
        token,
        base,
        purgeGeneration: header.purgeGeneration,
        contentRevision: header.contentRevision,
        ttlMs: bodyTtlMs,
      }),
    publish: async (
      snapshot: { readonly header: ObservationHeader; readonly body: string },
      base: ObservationBase,
      token: string,
    ) =>
      (await redis.publishObservation({
        resource: snapshot.header.resource,
        incarnation: current(),
        token,
        purgeGeneration: snapshot.header.purgeGeneration,
        base,
        contentRevision: snapshot.header.contentRevision,
        body: snapshot.body,
        ttlMs: bodyTtlMs,
      })) === 1,
  };
}
