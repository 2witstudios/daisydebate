/** Upper bounds of the hold-time buckets, so a busy lane costs fixed memory. */
const BUCKETS_MS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000,
];
type Tally = { count: number; totalMs: number; maxMs: number; bins: number[] };
/** One operation's holds of a lane's connections since the last drain. */
export type LaneHoldSummary = {
  readonly operation: string;
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
  /** An upper bound: the bucket holding the 95th percentile, capped at `maxMs`. */
  readonly p95Ms: number;
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

/** How long each operation held a lane's connections, per drain window. */
export function createHoldLedger() {
  let tallies = new Map<string, Tally>();
  return {
    record(operation: string, heldMs: number) {
      const tally = tallies.get(operation) ?? {
        count: 0,
        totalMs: 0,
        maxMs: 0,
        bins: new Array<number>(BUCKETS_MS.length + 1).fill(0),
      };
      tally.count += 1;
      tally.totalMs += heldMs;
      tally.maxMs = Math.max(tally.maxMs, heldMs);
      const bin = BUCKETS_MS.findIndex((bound) => heldMs <= bound);
      tally.bins[bin < 0 ? BUCKETS_MS.length : bin]! += 1;
      tallies.set(operation, tally);
    },
    drain(): readonly LaneHoldSummary[] {
      const drained = [...tallies].map(([operation, tally]) => ({
        operation,
        count: tally.count,
        totalMs: Math.round(tally.totalMs),
        maxMs: Math.ceil(tally.maxMs),
        p95Ms: Math.ceil(p95Of(tally)),
      }));
      tallies = new Map();
      return drained;
    },
  };
}
