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
export type WorkloadQueueOptions = {
  /** Bounded FIFO waiters per lane; an absent lane refuses as soon as it is saturated. */
  readonly queues?: Partial<Record<DatabaseWorkload, number>>;
  /** Oldest admissible wait before a queued operation is refused unrun. */
  readonly maxWaitMs?: number;
  readonly timers?: Timers;
};
const unavailable = () =>
  createAppError('INFRASTRUCTURE', 'Database capacity unavailable');
type Waiter = { readonly grant: () => void; readonly timer: unknown };

/** Non-borrowable reservations count actual work through commit/rollback settlement. */
export function createWorkloadExecutor(
  capacities: Partial<Record<DatabaseWorkload, number>>,
  {
    queues = {},
    maxWaitMs = 0,
    timers = globalThis as unknown as Timers,
  }: WorkloadQueueOptions = {},
) {
  const active = new Map<DatabaseWorkload, number>();
  const waiting = new Map<DatabaseWorkload, Waiter[]>();
  for (const capacity of [
    ...Object.values(capacities),
    ...Object.values(queues),
  ])
    if (!Number.isSafeInteger(capacity) || capacity < 0)
      throw createAppError('VALIDATION', 'Invalid database workload capacity');
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 0)
    throw createAppError('VALIDATION', 'Invalid database workload wait');
  const available = (lane: DatabaseWorkload) =>
    (active.get(lane) ?? 0) < (capacities[lane] ?? 0);
  const queueRoom = (lane: DatabaseWorkload) =>
    (waiting.get(lane)?.length ?? 0) < (queues[lane] ?? 0);
  // A settled slot passes directly to the oldest waiter, so arrivals cannot overtake the queue.
  const release = (lane: DatabaseWorkload) => () => {
    const next = waiting.get(lane)?.shift();
    if (next) {
      timers.clearTimeout(next.timer as never);
      next.grant();
    } else active.set(lane, (active.get(lane) ?? 1) - 1);
  };
  const acquire = (lane: DatabaseWorkload) => {
    if (!available(lane)) throw unavailable();
    active.set(lane, (active.get(lane) ?? 0) + 1);
    return release(lane);
  };
  const admit = (lane: DatabaseWorkload): Promise<() => void> => {
    if (!queueRoom(lane)) return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      const queue = waiting.get(lane) ?? [];
      waiting.set(lane, queue);
      const waiter: Waiter = {
        grant: () => resolve(release(lane)),
        timer: timers.setTimeout(() => {
          queue.splice(queue.indexOf(waiter), 1);
          reject(unavailable());
        }, maxWaitMs),
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
    /** Whether a synchronous builder may be constructed now, or must wait for a slot. */
    deferral: (lane: DatabaseWorkload): 'now' | 'queue' => {
      if (available(lane)) return 'now';
      if (queueRoom(lane)) return 'queue';
      throw unavailable();
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
  if (!Number.isSafeInteger(poolSize) || poolSize < 1)
    throw createAppError('VALIDATION', 'Invalid database pool capacity');
  const requested: Partial<Record<DatabaseWorkload, number>> =
    profile === 'projection'
      ? { projection: 2, headers: 1, relay: 1 }
      : profile === 'web'
        ? { control: 2, competitive: 4, social: 3, search: 1, admission: 2 }
        : {
            control: 1,
            renewal: 2,
            admission: 1,
            ...(profile === 'reconciliation'
              ? { projection: 2, headers: 1, relay: 1 }
              : {}),
          };
  let remaining = poolSize;
  const capacities: Partial<Record<DatabaseWorkload, number>> = {};
  for (const [lane, ceiling] of Object.entries(requested)) {
    capacities[lane as DatabaseWorkload] = Math.min(remaining, ceiling);
    remaining -= capacities[lane as DatabaseWorkload]!;
  }
  return capacities;
}

/** Waiters are counted before SQL: a bounded multiple of each lane's slots, never unbounded. */
export function workloadQueueOptions(
  capacities: Partial<Record<DatabaseWorkload, number>>,
) {
  return {
    queues: Object.fromEntries(
      Object.entries(capacities).map(([lane, slots]) => [lane, slots * 16]),
    ) as Partial<Record<DatabaseWorkload, number>>,
    maxWaitMs: 2_000,
  };
}
