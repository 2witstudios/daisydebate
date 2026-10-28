import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { laneClient } from './lane-client';
import { RUNTIME_SESSION } from './session-bounds';
import {
  createLaneGate,
  validateWorkloadProfile,
  type LaneBudget,
  type LaneGate,
  type LaneTimer,
  type WorkloadLane,
  type WorkloadProfile,
} from './workload-admission';

/** Dials one lane's pool; tests inject scripted clients at this seam. */
export type LaneConnector = (lane: WorkloadLane, connections: number) => SQL;

export const dialLanes =
  (url: string): LaneConnector =>
  (_lane, connections) =>
    new SQL(url, {
      max: connections,
      connectionTimeout: 3,
      idleTimeout: 20,
      connection: RUNTIME_SESSION,
    });

/** The lifetime connections (LISTEN, the availability election) outside every lane. */
export const dialDedicated = (url: string, connections: number) =>
  new SQL(url, {
    max: connections,
    connectionTimeout: 3,
    idleTimeout: 0,
    connection: RUNTIME_SESSION,
  });

/** A lane absent from the profile: every call refuses as `unconfigured`. */
const absentPool = () =>
  Object.assign(() => undefined, { options: {} }) as unknown as SQL;

export type Lane = {
  readonly name: WorkloadLane;
  readonly gate: LaneGate;
  /** The lane's admitted SQL handle; the raw pool never leaves the owner. */
  readonly client: SQL;
  /** A Drizzle database over `client`, so every query and transaction is admitted. */
  readonly database: ReturnType<typeof drizzle>;
  /**
   * Holds `weight` admitted connections while `work` reserves exactly that
   * many from the lane's own pool (a bounded writer's work + watchdog). The
   * pool is lent only for the duration of `work`.
   */
  readonly withSlots: <T>(
    weight: number,
    work: (pool: SQL) => Promise<T>,
  ) => Promise<T>;
};

/**
 * One lane over its own pool: the admitted client, a Drizzle database over
 * it, and slot-holding access for a bounded writer's own reservations.
 */
export function createLane(
  name: WorkloadLane,
  pool: SQL,
  budget: LaneBudget | undefined,
  options: {
    readonly timer?: LaneTimer | undefined;
    readonly fairnessKey?: (() => string | undefined) | undefined;
  } = {},
): Lane {
  const gate = createLaneGate(name, budget, options.timer);
  const client = laneClient(pool, gate, options.fairnessKey);
  return {
    name,
    gate,
    client,
    database: drizzle({ client }),
    async withSlots(weight, work) {
      const release = await gate.admit(weight, options.fairnessKey?.());
      try {
        return await work(pool);
      } finally {
        release();
      }
    },
  };
}

/**
 * The one PostgreSQL admission owner of a process (ADR 0088): one pool per
 * configured lane, sized to its reservation, so lanes cannot borrow from
 * each other; every handle is lane-bound when the composition root asks
 * for it.
 */
export function createWorkload({
  profile,
  connect,
  timer,
  fairnessKey,
}: {
  readonly profile: WorkloadProfile;
  readonly connect: LaneConnector;
  readonly timer?: LaneTimer | undefined;
  /** The current request's fairness key (client network on web). */
  readonly fairnessKey?: (() => string | undefined) | undefined;
}) {
  validateWorkloadProfile(profile);
  const lanes = new Map<WorkloadLane, Lane>();
  const pools: SQL[] = [];
  function lane(name: WorkloadLane): Lane {
    const existing = lanes.get(name);
    if (existing) return existing;
    const budget = profile.lanes[name];
    const pool = budget ? connect(name, budget.connections) : absentPool();
    if (budget) pools.push(pool);
    const created = createLane(name, pool, budget, { timer, fairnessKey });
    lanes.set(name, created);
    return created;
  }
  return {
    profile,
    lane,
    async close() {
      await Promise.all(pools.map((pool) => pool.close({ timeout: 5 })));
    },
  };
}
