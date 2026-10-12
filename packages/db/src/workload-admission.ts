import { createAppError } from '@daisy/errors';

export type DatabaseWorkload =
  | 'competitive'
  | 'social'
  | 'search'
  | 'admission'
  | 'renewal'
  | 'control'
  | 'headers'
  | 'projection'
  | 'relay'
  | 'ephemeral';

type Timers = {
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (id: never) => void;
};
/** Bounded FIFO waiters and the oldest admissible wait before a queued operation is refused unrun. */
type WorkloadQueue = {
  readonly depth: number;
  readonly maxWaitMs: number;
};
export type WorkloadQueueOptions = {
  /** An absent lane refuses as soon as it is saturated. */
  readonly queues?: Partial<Record<DatabaseWorkload, WorkloadQueue>>;
  readonly timers?: Timers;
  /** Every refusal is observable: the lane and whether its queue was full or the wait expired. */
  readonly onRefused?: (
    lane: DatabaseWorkload,
    reason: 'saturated' | 'expired',
  ) => void;
};
const unavailable = () =>
  createAppError('INFRASTRUCTURE', 'Database capacity unavailable');
type Waiter = { readonly grant: () => void; readonly timer: unknown };

/** Non-borrowable reservations count actual work through commit/rollback settlement. */
export function createWorkloadExecutor(
  capacities: Partial<Record<DatabaseWorkload, number>>,
  {
    queues = {},
    timers = globalThis as unknown as Timers,
    onRefused,
  }: WorkloadQueueOptions = {},
) {
  const refuse = (lane: DatabaseWorkload, reason: 'saturated' | 'expired') => {
    onRefused?.(lane, reason);
    return unavailable();
  };
  const active = new Map<DatabaseWorkload, number>();
  const waiting = new Map<DatabaseWorkload, Waiter[]>();
  for (const capacity of [
    ...Object.values(capacities),
    ...Object.values(queues).flatMap((q) => [q.depth, q.maxWaitMs]),
  ])
    if (!Number.isSafeInteger(capacity) || capacity < 0)
      throw createAppError('VALIDATION', 'Invalid database workload capacity');
  const available = (lane: DatabaseWorkload) =>
    (active.get(lane) ?? 0) < (capacities[lane] ?? 0);
  const queueRoom = (lane: DatabaseWorkload) =>
    (waiting.get(lane)?.length ?? 0) < (queues[lane]?.depth ?? 0);
  // A freed slot passes directly to the oldest waiter, so arrivals cannot overtake the queue;
  // an over-capacity eager settlement frees no slot until the lane is back under capacity.
  const release = (lane: DatabaseWorkload) => () => {
    active.set(lane, (active.get(lane) ?? 1) - 1);
    if (!available(lane)) return;
    const next = waiting.get(lane)?.shift();
    if (!next) return;
    timers.clearTimeout(next.timer as never);
    active.set(lane, (active.get(lane) ?? 0) + 1);
    next.grant();
  };
  const acquire = (lane: DatabaseWorkload) => {
    if (!available(lane)) throw refuse(lane, 'saturated');
    active.set(lane, (active.get(lane) ?? 0) + 1);
    return release(lane);
  };
  const admit = (lane: DatabaseWorkload): Promise<() => void> => {
    if (!queueRoom(lane)) return Promise.reject(refuse(lane, 'saturated'));
    return new Promise((resolve, reject) => {
      const queue = waiting.get(lane) ?? [];
      waiting.set(lane, queue);
      const waiter: Waiter = {
        grant: () => resolve(release(lane)),
        timer: timers.setTimeout(() => {
          const index = queue.indexOf(waiter);
          if (index >= 0) queue.splice(index, 1);
          reject(refuse(lane, 'expired'));
        }, queues[lane]!.maxWaitMs),
      };
      queue.push(waiter);
    });
  };
  const invoke = <T>(lane: DatabaseWorkload, work: () => T): T => {
    const settle = acquire(lane);
    try {
      const result = work();
      if (result instanceof Promise) return result.finally(settle) as T;
      settle();
      return result;
    } catch (error) {
      settle();
      throw error;
    }
  };
  return {
    invoke,
    /**
     * Construct a statement builder. Builders are lazy, so construction needs no slot while the lane
     * has queue room; their execution queues. An eager surface that starts work at construction is
     * counted as active until it settles, even when it briefly exceeds the lane's capacity.
     */
    construct: <T>(lane: DatabaseWorkload, build: () => T): T => {
      if (available(lane)) return invoke(lane, build);
      if (!queueRoom(lane)) throw refuse(lane, 'saturated');
      const result = build();
      if (!(result instanceof Promise)) return result;
      active.set(lane, (active.get(lane) ?? 0) + 1);
      return result.finally(release(lane)) as T;
    },
    /** A free slot starts work synchronously; a saturated lane waits in its bounded queue. */
    run: <T>(lane: DatabaseWorkload, work: () => Promise<T>): Promise<T> => {
      if (available(lane)) return invoke(lane, work);
      return admit(lane).then(async (settle) => {
        try {
          return await work();
        } finally {
          settle();
        }
      });
    },
  };
}

export type DatabaseWorkloadProfile =
  'web' | 'realtime' | 'reconciliation' | 'projection';
/** Physical pool ceilings include every allocated workload, never hidden extra pools. */
export function workloadCapacities(
  profile: DatabaseWorkloadProfile,
  poolSize: number,
) {
  const requested: Partial<Record<DatabaseWorkload, number>> =
    profile === 'projection'
      ? { projection: 2, headers: 1, relay: 1 }
      : profile === 'web'
        ? { control: 4, competitive: 4, social: 3, search: 1 }
        : {
            control: 1,
            renewal: 2,
            admission: 1,
            ...(profile === 'reconciliation'
              ? { projection: 2, headers: 1, relay: 1 }
              : {}),
          };
  const lanes = Object.keys(requested) as DatabaseWorkload[];
  // Every lane must be able to run; a pool that cannot give each one a slot is a configuration error.
  if (!Number.isSafeInteger(poolSize) || poolSize < lanes.length)
    throw createAppError('VALIDATION', 'Invalid database pool capacity');
  const capacities = Object.fromEntries(
    lanes.map((lane) => [lane, 1]),
  ) as Partial<Record<DatabaseWorkload, number>>;
  let remaining = poolSize - lanes.length;
  for (const lane of lanes) {
    const grant = Math.min(remaining, requested[lane]! - 1);
    capacities[lane] = capacities[lane]! + grant;
    remaining -= grant;
  }
  // Unreserved connections serve the interactive default lane, or the profile's primary lane.
  const spare = lanes.includes('control') ? 'control' : lanes[0]!;
  capacities[spare] = capacities[spare]! + remaining;
  return capacities;
}

/**
 * Waiters are counted before SQL. Competitive, social and search refuse quickly so a saturated node
 * sheds load instead of stacking latency (plan starting calibrations). Control is the interactive
 * default (sign-in, session reads, account and mail work): bursts of short operations such as a
 * sign-in flood must queue rather than fail, so it holds a deep but bounded queue. Calibration: a
 * 1,200-request sign-up flood over 1,000 connections (ISSUE-185) must answer every request; a waiter
 * costs a promise and a timer, so depth bounds memory cheaply while the 2s age bounds latency.
 */
const queueProfile: Record<DatabaseWorkload, WorkloadQueue> = {
  competitive: { depth: 16, maxWaitMs: 50 },
  social: { depth: 16, maxWaitMs: 100 },
  search: { depth: 16, maxWaitMs: 100 },
  admission: { depth: 100, maxWaitMs: 250 },
  renewal: { depth: 100, maxWaitMs: 250 },
  projection: { depth: 64, maxWaitMs: 500 },
  headers: { depth: 64, maxWaitMs: 500 },
  relay: { depth: 16, maxWaitMs: 500 },
  control: { depth: 2_048, maxWaitMs: 2_000 },
  ephemeral: { depth: 16, maxWaitMs: 100 },
};
/** Queues for exactly the lanes this pool reserves. */
export function workloadQueueOptions(
  capacities: Partial<Record<DatabaseWorkload, number>>,
): WorkloadQueueOptions {
  return {
    queues: Object.fromEntries(
      Object.keys(capacities).map((lane) => [
        lane,
        queueProfile[lane as DatabaseWorkload],
      ]),
    ),
  };
}
