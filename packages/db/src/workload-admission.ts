import { currentLaneOperation } from './lane-operation';
import { createAppError } from '@daisy/errors';
import { refuseCapacity } from './capacity-refusal';
import { RUNTIME_SESSION } from './session-bounds';

/**
 * The classes of PostgreSQL work one process runs (ADR 0088). A lane is a
 * reserved, non-borrowable share of the process's connections: work on one
 * lane can never take another lane's connections, so a social or audience
 * flood cannot starve a Round.
 */
const WORKLOAD_LANES = [
  'competitive',
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
    dedicated: 1,
    lanes: {
      competitive: COMPETITIVE,
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
  Object.values(profile.lanes).reduce(
    (total, budget) => total + (budget?.connections ?? 0),
    profile.dedicated,
  );

export function validateWorkloadProfile(profile: WorkloadProfile) {
  if (!Number.isSafeInteger(profile.dedicated) || profile.dedicated < 0)
    throw createAppError('INVARIANT', 'Invalid workload lane budget');
  for (const [name, budget] of Object.entries(profile.lanes)) {
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
};
export type LaneTimer = (ms: number, fire: () => void) => () => void;
export type LaneClock = () => number;
const systemTimer: LaneTimer = (ms, fire) => {
  const handle = setTimeout(fire, ms);
  return () => clearTimeout(handle);
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
  timer: LaneTimer = systemTimer,
  clock: LaneClock = () => performance.now(),
  operationNow: () => string = currentLaneOperation,
): LaneGate {
  let active = 0;
  let waiting = 0;
  const held = new Set<{
    readonly since: number;
    readonly operation: string;
    readonly weight: number;
  }>();
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
  const release = (weight: number, operation: string): LaneRelease => {
    let released = false;
    const hold = { since: clock(), operation, weight };
    held.add(hold);
    return () => {
      if (released) return;
      released = true;
      held.delete(hold);
      active -= weight;
      pump();
    };
  };
  function pump() {
    while (order.length > 0) {
      const key = order[0]!;
      const queue = queues.get(key)!;
      const head = queue[0]!;
      if (active + head.weight > budget!.connections) return;
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
          grant: () => resolve(release(weight, operation)),
          cancel: () => undefined,
        };
        waiter.cancel = timer(budget.maxWaitMs, () => {
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
  };
}
