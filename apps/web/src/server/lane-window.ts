import type { DatabaseResources } from '@daisy/db/resources';

type Gauge = ReturnType<DatabaseResources['laneGauges']>[number];
export type LaneHolds = ReturnType<DatabaseResources['drainLaneHolds']>[number];
/** A lane's sampled occupancy over one window. */
export type LaneOccupancy = {
  readonly connections: number;
  readonly samples: number;
  readonly activeSum: number;
  readonly activeMax: number;
  readonly waitingSum: number;
  readonly waitingMax: number;
};
export type LaneWindowLine =
  | {
      readonly event: 'db.lane.window';
      readonly fields: { readonly lane: string } & LaneOccupancy & {
          readonly holds: number;
          readonly durationMs: number;
          readonly maxMs: number;
          readonly p95Ms: number;
          readonly waits: number;
        };
    }
  | {
      readonly event: 'db.lane.hold';
      readonly fields: {
        readonly lane: string;
        readonly operation: string;
        readonly holds: number;
        readonly durationMs: number;
        readonly maxMs: number;
        readonly p95Ms: number;
        readonly waits: number;
      };
    };

/**
 * The hold budget: a hold this long is worth naming its operation, as long
 * as the competitive lane's whole one-second wait-out.
 */
const SLOW_HOLD_MS = 1000;

/** One more sample of a lane into its window. */
export const sampled = (
  window: LaneOccupancy | undefined,
  gauge: Gauge,
): LaneOccupancy => ({
  connections: gauge.connections,
  samples: (window?.samples ?? 0) + 1,
  activeSum: (window?.activeSum ?? 0) + gauge.active,
  activeMax: Math.max(window?.activeMax ?? 0, gauge.active),
  waitingSum: (window?.waitingSum ?? 0) + gauge.waiting,
  waitingMax: Math.max(window?.waitingMax ?? 0, gauge.waiting),
});

const NO_OCCUPANCY: LaneOccupancy = {
  connections: 0,
  samples: 0,
  activeSum: 0,
  activeMax: 0,
  waitingSum: 0,
  waitingMax: 0,
};

/**
 * One window's log lines: one summary per lane (occupancy and every hold),
 * and an operation's own line only when one of its holds queued for the
 * lane or reached the hold budget, or the process asked for detail
 * (LOG_LEVEL debug). An idle process writes one line per opened lane per
 * window, never one per operation.
 */
export function laneWindowLines(input: {
  readonly occupancy: ReadonlyMap<string, LaneOccupancy>;
  readonly holds: readonly LaneHolds[];
  readonly detail: boolean;
  readonly slowHoldMs?: number;
}): readonly LaneWindowLine[] {
  const slowHoldMs = input.slowHoldMs ?? SLOW_HOLD_MS;
  const holdsByLane = new Map<string, LaneHolds>(
    input.holds.map((held) => [held.lane, held]),
  );
  const lanes = [
    ...new Set([...input.occupancy.keys(), ...holdsByLane.keys()]),
  ];
  return lanes.flatMap((lane): LaneWindowLine[] => {
    const held = holdsByLane.get(lane);
    const total = held?.total ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      p95Ms: 0,
      waits: 0,
    };
    const summary: LaneWindowLine = {
      event: 'db.lane.window',
      fields: {
        lane,
        ...(input.occupancy.get(lane) ?? NO_OCCUPANCY),
        holds: total.count,
        durationMs: total.totalMs,
        maxMs: total.maxMs,
        p95Ms: total.p95Ms,
        waits: total.waits,
      },
    };
    const named = (held?.operations ?? [])
      .filter(
        ({ maxMs, waits }) => input.detail || waits > 0 || maxMs >= slowHoldMs,
      )
      .map(
        ({
          operation,
          count,
          totalMs,
          maxMs,
          p95Ms,
          waits,
        }): LaneWindowLine => ({
          event: 'db.lane.hold',
          fields: {
            lane,
            operation,
            holds: count,
            durationMs: totalMs,
            maxMs,
            p95Ms,
            waits,
          },
        }),
      );
    return [summary, ...named];
  });
}
