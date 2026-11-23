import { SQL } from 'bun';
import type { Waits } from '@daisy/clock';
import { drizzle } from 'drizzle-orm/bun-sql';
import { laneClient } from './lane-client';
import { RUNTIME_SESSION } from './session-bounds';
import { afterMs } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { causeChainMember } from './raw-rows';
import { AsyncLocalStorage } from 'node:async_hooks';

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
const absentPool = () => new SQL('postgres://127.0.0.1:1/daisy_unconfigured');

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
    /** The time the lane's waiters expire on (R4.7). */
    readonly waits: Waits;
    readonly fairnessKey?: (() => string | undefined) | undefined;
  },
): Lane {
  const gate = createLaneGate(name, budget, options.waits);
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
  waits,
  fairnessKey,
}: {
  readonly profile: WorkloadProfile;
  readonly connect: LaneConnector;
  /** The time every lane's waiters expire on (R4.7). */
  readonly waits: Waits;
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
    const created = createLane(name, pool, budget, { waits, fairnessKey });
    lanes.set(name, created);
    return created;
  }
  return {
    profile,
    lane,
    /** Each lane opened so far: its size and what it holds and queues right now. */
    laneGauges: () =>
      [...lanes.values()].map(({ name, gate }) => ({
        lane: name,
        connections: profile.lanes[name]?.connections ?? 0,
        ...gate.stats(),
      })),
    /** Each lane's hold time since the last drain, whole and per operation. */
    drainLaneHolds: () =>
      [...lanes.values()].map(({ name, gate }) => ({
        lane: name,
        ...gate.drainHolds(),
      })),
    async close() {
      await Promise.all(pools.map((pool) => pool.close({ timeout: 5 })));
    },
  };
}

/**
 * The classes of PostgreSQL work one process runs (ADR 0088). A lane is a
 * reserved, non-borrowable share of the process's connections: work on one
 * lane can never take another lane's connections, so a social or audience
 * flood cannot starve a Round.
 */
const WORKLOAD_LANES = [
  'competitive',
  'documents',
  'social',
  'search',
  'audience',
  'browse',
  'control',
  'admission',
  'renewal',
  'headers',
  'projection',
  'relay',
] as const;
export type WorkloadLane = (typeof WORKLOAD_LANES)[number];

export type LaneBudget = {
  /** Connections reserved for this lane; also its pool's size. */
  readonly connections: number;
  /** Counted waiters beyond the running work; one more is refused at once. */
  readonly queue: number;
  /** The longest a waiter queues; nothing has run when it is refused. */
  readonly maxWaitMs: number;
};
export type WorkloadProfile = {
  readonly name: string;
  /**
   * Connections held for the process lifetime outside every lane: LISTEN
   * subscriptions and the availability election session.
   */
  readonly dedicated: number;
  readonly lanes: Readonly<Partial<Record<WorkloadLane, LaneBudget>>>;
};

const lane = (connections: number, queue: number, maxWaitMs: number) => ({
  connections,
  queue,
  maxWaitMs,
});
/**
 * Writers take the competitive lane for 1s, the wait-out ISSUE-508 needs
 * for the process's own maintenance, judging, bot and attendance loops; a
 * bounded writer weighs two connections (work + watchdog).
 */
const COMPETITIVE = lane(10, 16, 1000);
/**
 * Subscribes and hellos share one connection and each read takes the account
 * fence. A mitigation for ISSUE-914, whose trigger is not established: a
 * waiter outlasts one read that blocks once to the session's lock bound, and a
 * burst of reads, instead of expiring at 250 ms. It does not outlast several
 * blocked reads in a row, and a Round subscribe takes this lane three times
 * inside one 5s budget, so ADR 0088 §6 states where throughput falls. A
 * refusal's pressure fields say what the lane was waiting on.
 */
const SUBSCRIBE_ADMISSION = lane(1, 100, RUNTIME_SESSION.lock_timeout + 1000);
/** The deployed starting profiles; the connection budget is checked from them. */
export const WORKLOAD_PROFILES = {
  web: {
    name: 'web',
    // The availability election session, and the worker wake LISTEN (ADR 0154).
    dedicated: 2,
    lanes: {
      competitive: COMPETITIVE,
      // A member's documents, a live debater's saves included (ADR 0111). A save
      // waits out a burst; refused, it stays in draft recovery and retries.
      documents: lane(3, 64, 1000),
      // One at a time, so a slow search can never hold up a save.
      search: lane(1, 8, 250),
      social: lane(4, 16, 100),
      // The Watch audience: viewers read a per-Round cached answer, so a read here
      // is rare and a queue only delays a viewer who can keep what they have. A
      // full lane refuses at once, and they come back later (ADR 0088 §6).
      audience: lane(2, 0, 1),
      // Public pages that are not a live audience: standings, profiles, recordings.
      browse: lane(2, 32, 250),
      // Auth bursts queue behind the sign-up ceiling and network limits,
      // which decide what is shed (AUTH-3.10, proven on 10 connections). The
      // count and age here are a backstop, never the shedding mechanism.
      control: lane(10, 4096, 30_000),
    },
  },
  realtime: {
    name: 'realtime',
    dedicated: 3,
    lanes: {
      admission: SUBSCRIBE_ADMISSION,
      renewal: lane(2, 64, 1000),
      control: lane(1, 16, 1000),
    },
  },
  /** A realtime process eligible to own observed resources (ADR 0089). */
  'realtime-observer': {
    name: 'realtime-observer',
    dedicated: 3,
    lanes: {
      admission: SUBSCRIBE_ADMISSION,
      renewal: lane(2, 64, 1000),
      control: lane(1, 16, 1000),
      headers: lane(1, 4, 500),
      projection: lane(2, 64, 500),
      relay: lane(1, 4, 1000),
    },
  },
} as const satisfies Record<string, WorkloadProfile>;

/** Every connection one process of a profile can hold, dedicated ones included. */
export const profileConnections = (profile: WorkloadProfile): number =>
  Object.values<LaneBudget | undefined>(profile.lanes).reduce(
    (total, budget) => total + (budget?.connections ?? 0),
    profile.dedicated,
  );

export function validateWorkloadProfile(profile: WorkloadProfile) {
  if (!Number.isSafeInteger(profile.dedicated) || profile.dedicated < 0)
    throw createAppError('INVARIANT', 'Invalid workload lane budget');
  for (const [name, budget] of Object.entries<LaneBudget | undefined>(
    profile.lanes,
  )) {
    if (!budget) continue;
    const valid =
      (WORKLOAD_LANES as readonly string[]).includes(name) &&
      Number.isSafeInteger(budget.connections) &&
      budget.connections >= 1 &&
      Number.isSafeInteger(budget.queue) &&
      budget.queue >= 0 &&
      Number.isSafeInteger(budget.maxWaitMs) &&
      budget.maxWaitMs >= 1;
    if (!valid)
      throw createAppError('INVARIANT', 'Invalid workload lane budget');
  }
  return profile;
}

export type LaneRelease = () => void;
export type LaneGate = {
  /**
   * Takes `weight` connections of the lane, waiting in its counted queue at
   * most `maxWaitMs`. The returned release is idempotent; call it only once
   * the work has settled (committed, rolled back or destroyed).
   */
  readonly admit: (weight?: number, key?: string) => Promise<LaneRelease>;
  readonly stats: () => {
    readonly active: number;
    readonly waiting: number;
  };
  /** How long each operation held this lane's connections since the last drain. */
  readonly drainHolds: () => LaneHolds;
};

type Waiter = {
  readonly weight: number;
  readonly grant: () => void;
  cancel: () => void;
};

const holdersByOperation = (
  holds: Iterable<{ readonly operation: string; readonly weight: number }>,
) => {
  const totals: Record<string, number> = {};
  for (const { operation, weight } of holds)
    totals[operation] = (totals[operation] ?? 0) + weight;
  return totals;
};

/**
 * One lane's admission: counted waiters, FIFO within a fairness key and
 * round-robin across keys, each waiter refused once it is `maxWaitMs` old.
 * A waiter that does not fit the free connections holds its turn, so a
 * two-connection writer is never starved by one-connection readers.
 */
export function createLaneGate(
  name: WorkloadLane,
  budget: LaneBudget | undefined,
  /** The time waiters expire and holds are measured on (R4.7). */
  waits: Waits,
  operationNow: () => string = currentLaneOperation,
): LaneGate {
  const clock = waits.nowMs;
  let active = 0;
  let waiting = 0;
  const held = new Set<{
    readonly since: number;
    readonly operation: string;
    readonly weight: number;
  }>();
  const holds = createHoldLedger();
  const queues = new Map<string, Waiter[]>();
  const order: string[] = [];
  const refuse = (reason: 'unconfigured' | 'saturated' | 'expired') =>
    refuseCapacity({
      lane: name,
      reason,
      pressure: {
        pending: waiting,
        running: active,
        oldestAgeMs: Math.round(
          Math.max(0, ...[...held].map(({ since }) => clock() - since)),
        ),
      },
      holders: holdersByOperation(held),
    });
  const release = (
    weight: number,
    operation: string,
    waited = false,
  ): LaneRelease => {
    let released = false;
    const hold = { since: clock(), operation, weight };
    held.add(hold);
    return () => {
      if (released) return;
      released = true;
      held.delete(hold);
      holds.record(operation, clock() - hold.since, waited);
      active -= weight;
      pump();
    };
  };
  function pump() {
    if (!budget) return;
    while (order.length > 0) {
      const key = order[0]!;
      const queue = queues.get(key);
      const head = queue?.at(0);
      if (!queue || !head)
        throw createAppError('INVARIANT', 'Queued lane has no waiter');
      if (active + head.weight > budget.connections) return;
      queue.shift();
      waiting -= 1;
      order.shift();
      if (queue.length > 0) order.push(key);
      else queues.delete(key);
      active += head.weight;
      head.cancel();
      head.grant();
    }
  }
  function remove(key: string, waiter: Waiter) {
    const queue = queues.get(key);
    const at = queue?.indexOf(waiter) ?? -1;
    if (!queue || at < 0) return;
    queue.splice(at, 1);
    waiting -= 1;
    if (queue.length === 0) {
      queues.delete(key);
      order.splice(order.indexOf(key), 1);
    }
    pump();
  }
  return {
    admit(weight = 1, key = '') {
      if (!budget) return Promise.reject(refuse('unconfigured'));
      if (!Number.isSafeInteger(weight) || weight < 1)
        return Promise.reject(
          createAppError('INVARIANT', 'Invalid lane admission weight'),
        );
      if (weight > budget.connections)
        return Promise.reject(refuse('unconfigured'));
      // Read here, not at the grant: a waiter is granted from another's release.
      const operation = operationNow();
      if (waiting === 0 && active + weight <= budget.connections) {
        active += weight;
        return Promise.resolve(release(weight, operation));
      }
      if (waiting >= budget.queue) return Promise.reject(refuse('saturated'));
      return new Promise<LaneRelease>((resolve, reject) => {
        const waiter: Waiter = {
          weight,
          grant: () => resolve(release(weight, operation, true)),
          cancel: () => undefined,
        };
        waiter.cancel = afterMs(waits, budget.maxWaitMs, () => {
          remove(key, waiter);
          reject(refuse('expired'));
        });
        const queue = queues.get(key);
        if (queue) queue.push(waiter);
        else {
          queues.set(key, [waiter]);
          order.push(key);
        }
        waiting += 1;
      });
    },
    stats: () => ({ active, waiting }),
    drainHolds: holds.drain,
  };
}
/** Upper bounds of the hold-time buckets, so a busy lane costs fixed memory. */
const BUCKETS_MS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000,
];
type Tally = {
  count: number;
  totalMs: number;
  maxMs: number;
  waits: number;
  bins: number[];
};
/** How long a set of holds kept a lane's connections, in whole milliseconds. */
export type HoldStats = {
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
  /** An upper bound: the bucket holding the 95th percentile, capped at `maxMs`. */
  readonly p95Ms: number;
  /** Holds that queued for the lane before they were granted. */
  readonly waits: number;
};
/** One operation's holds of a lane's connections since the last drain. */
type LaneHoldSummary = HoldStats & { readonly operation: string };
/** A lane's holds since the last drain: the whole lane, then each operation. */
export type LaneHolds = {
  readonly total: HoldStats;
  readonly operations: readonly LaneHoldSummary[];
};

const emptyTally = (): Tally => ({
  count: 0,
  totalMs: 0,
  maxMs: 0,
  waits: 0,
  bins: new Array<number>(BUCKETS_MS.length + 1).fill(0),
});

const recorded = (tally: Tally, heldMs: number) => {
  tally.count += 1;
  tally.totalMs += heldMs;
  tally.maxMs = Math.max(tally.maxMs, heldMs);
  const bin = BUCKETS_MS.findIndex((bound) => heldMs <= bound);
  tally.bins[bin < 0 ? BUCKETS_MS.length : bin]! += 1;
  return tally;
};

const p95Of = ({ bins, count, maxMs }: Tally) => {
  const rank = Math.ceil(count * 0.95);
  let seen = 0;
  for (const [index, held] of bins.entries()) {
    seen += held;
    if (seen >= rank) return Math.min(BUCKETS_MS[index] ?? maxMs, maxMs);
  }
  return maxMs;
};

const statsOf = (tally: Tally): HoldStats => ({
  count: tally.count,
  totalMs: Math.round(tally.totalMs),
  maxMs: Math.ceil(tally.maxMs),
  p95Ms: Math.ceil(p95Of(tally)),
  waits: tally.waits,
});

/**
 * How long a lane's holds lasted per drain window: the whole lane (its p95
 * over every hold, not a mix of per-operation bounds) and each operation.
 */
export function createHoldLedger() {
  let total = emptyTally();
  let tallies = new Map<string, Tally>();
  return {
    /** One released hold; `waited` when it queued before its grant. */
    record(operation: string, heldMs: number, waited = false) {
      const tally = recorded(tallies.get(operation) ?? emptyTally(), heldMs);
      recorded(total, heldMs);
      if (waited) {
        tally.waits += 1;
        total.waits += 1;
      }
      tallies.set(operation, tally);
    },
    drain(): LaneHolds {
      const drained = {
        total: statsOf(total),
        operations: [...tallies].map(([operation, tally]) => ({
          operation,
          ...statsOf(tally),
        })),
      };
      total = emptyTally();
      tallies = new Map();
      return drained;
    },
  };
}

/**
 * One per process, not per module copy: Next can bundle a page apart
 * (ISSUE-927). The process-wide slot is a static member of the host object,
 * so nothing else of the host is reached (R4.7).
 */
const store = ((
  globalThis as { 'daisy.db.lane-operation'?: AsyncLocalStorage<string> }
)['daisy.db.lane-operation'] ??= new AsyncLocalStorage<string>());

/** Runs `work` so a lane admitting it can say which operation holds its slot. */
export const withLaneOperation = <T>(operation: string, work: () => T): T =>
  store.run(operation, work);

/** The operation asking for a slot; `unlabelled` shows work no operation wraps. */
export const currentLaneOperation = () => store.getStore() ?? 'unlabelled';

const isPlain = (value: object) => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const holdsOperations = (value: object): boolean =>
  isPlain(value) &&
  Object.values(value).some(
    (member) =>
      typeof member === 'function' ||
      (typeof member === 'object' &&
        member !== null &&
        holdsOperations(member)),
  );
const isLazy = (value: object): value is PromiseLike<unknown> =>
  !(value instanceof Promise) &&
  typeof (value as { then?: unknown }).then === 'function';

const named = (
  name: string,
  operation: (...args: never[]) => unknown,
  self: object,
) =>
  Object.assign(
    (...args: never[]) =>
      withLaneOperation(name, () => {
        const result = operation.apply(self, args);
        if (typeof result !== 'object' || result === null) return result;
        // A lazy query starts when awaited: hold the name across that.
        if (isLazy(result)) return withLaneOperation(name, async () => result);
        // A store a factory hands back holds operations of its own.
        return holdsOperations(result)
          ? namedMembers(result, `${name}.`)
          : result;
      }),
    operation,
  );

const namedMembers = <T extends object>(members: T, prefix: string): T =>
  Object.fromEntries(
    Object.entries(members).map(([key, value]) => [
      key,
      typeof value === 'function'
        ? named(`${prefix}${key}`, value, members)
        : typeof value === 'object' && value !== null && holdsOperations(value)
          ? namedMembers(value, `${prefix}${key}.`)
          : value,
    ]),
  ) as T;

/**
 * The same operations, each holding its lane under its own name, nested stores
 * included (`friendStore.withContacts`). An `instrumented` inside one still
 * names its own work; a sync return stays sync.
 */
export const namedLaneOperations = <T extends object>(operations: T): T =>
  namedMembers(operations, '');

/** Why a lane refused work that never ran (ADR 0088). */
type CapacityRefusalReason = 'unconfigured' | 'saturated' | 'expired';
export type CapacityRefusalDetail = {
  /** The lane that refused; `unknown` only for a refusal minted without one. */
  readonly lane: WorkloadLane | 'unknown';
  readonly reason: CapacityRefusalReason;
  /**
   * The lane when it refused: waiters still queued, connections taken, and how
   * long the oldest running work had held its slot. One long hold with few
   * waiters is a stuck holder; many waiters behind short holds is a burst.
   */
  readonly pressure?: {
    readonly pending: number;
    readonly running: number;
    readonly oldestAgeMs: number;
  };
  /** Connections held when it refused, by the operation that asked for each. */
  readonly holders?: Readonly<Record<string, number>>;
};

const CAPACITY_UNAVAILABLE = 'Database capacity unavailable';
type RefusalRegistry = {
  readonly refusals: WeakMap<Error, CapacityRefusalDetail>;
  /** Errors whose capacity refusal the database boundary already logged. */
  readonly reportedRefusals: WeakSet<Error>;
};
/**
 * One registry per process, not per module copy: Next can bundle a page apart
 * from the process app, so the copy that reads a refusal may not be the one
 * that minted it (ISSUE-927). A table keeps each refusal's frozen detail and
 * reported mark off the error, which wrappers and reporters see.
 */
const registry = ((
  globalThis as { 'daisy.db.capacity-refusals'?: RefusalRegistry }
)['daisy.db.capacity-refusals'] ??= {
  refusals: new WeakMap(),
  reportedRefusals: new WeakSet(),
});
const { refusals, reportedRefusals } = registry;
const refusalIn = (error: unknown) =>
  causeChainMember((candidate) => refusals.has(candidate), error);

/** Refused-unrun admission identity, through bounded native cause wrappers. */
export const isCapacityRefusal = (error: unknown): boolean =>
  refusalIn(error) !== undefined;
/**
 * A refusal asking again can clear. `unconfigured` cannot: a lane missing from
 * the profile, or work heavier than the lane, is the same on every request.
 */
export const isTemporaryRefusal = (error: unknown): boolean => {
  const reason = capacityRefusalDetail(error)?.reason;
  return reason === 'saturated' || reason === 'expired';
};
/** The lane and reason of the refusal `error` carries, if it carries one. */
export function capacityRefusalDetail(
  error: unknown,
): CapacityRefusalDetail | undefined {
  const refusal = refusalIn(error);
  return refusal ? refusals.get(refusal) : undefined;
}
/** A refusal's loggable fields: which lane, why, and how that lane stood. */
export function capacityRefusalFields(error: unknown) {
  const detail = capacityRefusalDetail(error);
  return (
    detail && { cause: `${detail.lane}.${detail.reason}`, ...detail.pressure }
  );
}
/**
 * Records that `db.capacity.refused` was emitted for this rejection. The
 * refusal itself is marked, not the wrapper that carried it, so any other
 * wrapper of the same refusal is recognised as already reported.
 */
export function markCapacityRefusalReported(error: unknown) {
  const refusal = refusalIn(error);
  if (refusal) reportedRefusals.add(refusal);
}
/**
 * The one report of what held a refusing lane: one line per operation, largest
 * first. A refusal is reported once, by whichever boundary reaches it first.
 */
export function reportCapacityHolders(
  error: unknown,
  log: (
    event: 'db.capacity.holder',
    fields: {
      readonly operation: string;
      readonly cause: string;
      readonly running: number;
    },
    message: string,
  ) => void,
) {
  const detail = capacityRefusalDetail(error);
  if (!detail || isReportedCapacityRefusal(error)) return;
  markCapacityRefusalReported(error);
  for (const [operation, running] of Object.entries(detail.holders ?? {}).sort(
    ([, a], [, b]) => b - a,
  ))
    log(
      'db.capacity.holder',
      { operation, cause: detail.lane, running },
      'Operation holding the refusing lane',
    );
}
/**
 * A capacity refusal the database boundary already reported, so a caller
 * further out suppresses its duplicate rather than logging it again.
 */
export const isReportedCapacityRefusal = (error: unknown): boolean =>
  causeChainMember((candidate) => reportedRefusals.has(candidate), error) !==
  undefined;
/** The one admission refusal `isCapacityRefusal` recognises: retryable INFRASTRUCTURE. */
export function refuseCapacity(
  detail: CapacityRefusalDetail = { lane: 'unknown', reason: 'saturated' },
) {
  const refusal = createAppError('INFRASTRUCTURE', CAPACITY_UNAVAILABLE);
  refusals.set(refusal, Object.freeze({ ...detail }));
  return refusal;
}
