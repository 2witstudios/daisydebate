import type { SQL } from 'bun';
import type { Waits } from '@daisy/clock';
import {
  createBoundedTransaction,
  type BoundedTransaction,
} from './bounded-transaction';
import type { DatabaseEventSink } from './instrumented';
import { registerResources } from './resource-handles';
import { roomCommandTransaction } from './room-command-transaction';
import type { TransactionRunner } from './tx';
import {
  createWorkload,
  dialDedicated,
  dialLanes,
  WORKLOAD_PROFILES,
  type WorkloadLane,
  type WorkloadProfile,
} from './workload';

export { WORKLOAD_PROFILES, type WorkloadProfile } from './workload';
export type { DatabaseEventSink } from './instrumented';

type Workload = ReturnType<typeof createWorkload>;

/**
 * What a process opened on PostgreSQL (ADR 0088): one pool per lane its
 * profile reserves, the dedicated connections LISTEN and the availability
 * election hold outside every lane, and the event sink every store reports
 * to. A process opens it once, composes the stores it uses over it, and
 * closes it last. Its connections never leave the package: a store reaches
 * them through the package-private `resourcesOf`; a caller only closes and
 * observes.
 */
export type DatabaseResources = {
  readonly profile: WorkloadProfile;
  /** Each lane opened so far: its size and what it holds and queues now. */
  readonly laneGauges: Workload['laneGauges'];
  /** Each lane's hold time since the last drain, whole and per operation. */
  readonly drainLaneHolds: Workload['drainLaneHolds'];
  /** Closes every lane pool and the dedicated connections. */
  readonly close: () => Promise<void>;
};

/**
 * Opens a process's database resources. Nothing connects until a store
 * first runs work on a lane.
 */
export function openDatabaseResources({
  url,
  profile = WORKLOAD_PROFILES.web,
  waits,
  eventSink,
  client: injectedClient,
  fairnessKey,
}: {
  readonly url: string;
  /** The process's lane reservations; web unless a caller asks for another. */
  readonly profile?: WorkloadProfile | undefined;
  /** The process's time: every lane wait, transaction budget and connection bound (R4.7). */
  readonly waits: Waits;
  readonly eventSink?: DatabaseEventSink | undefined;
  /** Overrides dialing `url` for every lane; tests inject a scripted client at this seam. */
  readonly client?: SQL | undefined;
  /** The current request's fairness key (its client network). */
  readonly fairnessKey?: (() => string | undefined) | undefined;
}): DatabaseResources {
  const workload = createWorkload({
    profile,
    connect: injectedClient ? () => injectedClient : dialLanes(url),
    waits,
    fairnessKey,
  });
  const dedicated =
    injectedClient ?? dialDedicated(url, Math.max(1, profile.dedicated));
  const runners = new Map<WorkloadLane, BoundedTransaction>();
  let roomCommands: TransactionRunner | undefined;
  const resources: DatabaseResources = {
    profile,
    laneGauges: workload.laneGauges,
    drainLaneHolds: workload.drainLaneHolds,
    async close() {
      await workload.close();
      if (dedicated !== injectedClient) await dedicated.close({ timeout: 5 });
    },
  };
  registerResources(resources, {
    profile,
    waits,
    eventSink,
    lane: workload.lane,
    bounded(name) {
      const known = runners.get(name);
      if (known) return known;
      const runner = createBoundedTransaction({
        lane: workload.lane(name),
        waits,
      });
      runners.set(name, runner);
      return runner;
    },
    /*
     * Room preparation may wait on consent while holding its transaction, so
     * it takes at most half the competitive lane, once per process.
     */
    roomCommands: () =>
      (roomCommands ??= roomCommandTransaction(
        workload.lane('competitive').client,
        Math.max(
          1,
          Math.floor((profile.lanes.competitive?.connections ?? 0) / 2),
        ),
        waits,
      )),
    dedicated,
  });
  return resources;
}

type Composed<
  Stores extends readonly object[],
  Into = unknown,
> = Stores extends readonly [
  infer First,
  ...infer Rest extends readonly object[],
]
  ? Composed<Rest, Into & First>
  : Into;

/**
 * A process's database: its stores' operations in one object. Two stores
 * that expose the same name refuse here, when the process composes them,
 * instead of the later one silently answering for both.
 */
export function composeStores<const Stores extends readonly object[]>(
  ...stores: Stores
): Composed<Stores> {
  const composed: Record<string, unknown> = {};
  for (const store of stores)
    for (const [name, operation] of Object.entries(store)) {
      if (Object.hasOwn(composed, name))
        throw new Error(`Two composed stores both expose ${name}`);
      composed[name] = operation;
    }
  return composed as Composed<Stores>;
}
