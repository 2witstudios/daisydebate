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
