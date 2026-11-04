/**
 * Time the Round clock did not run. A stop is a closed span once its end is
 * known; an open one is still running, so anything waiting on it stays frozen.
 * Every wait that is not a speech (a countdown, a strike window, prep) reads
 * its deadline through these two rules, so a stop moves them all alike.
 */
export type ClockStop = {
  readonly from: string;
  readonly to: string | null;
};

const spanOf = (stop: ClockStop, nowMs: number) => ({
  fromMs: Date.parse(stop.from),
  toMs: stop.to === null ? nowMs : Date.parse(stop.to),
});

/** When a wait of `waitMs` from `anchorMs` ends, given the clock stopped in `stops`. */
export const dueAfterStops = (
  anchorMs: number,
  waitMs: number,
  stops: readonly ClockStop[],
  nowMs: number,
): number =>
  stops
    .map((stop) => spanOf(stop, nowMs))
    .sort((a, b) => a.fromMs - b.fromMs)
    .reduce((due, { fromMs, toMs }) => {
      const startMs = Math.max(fromMs, anchorMs);
      return toMs > startMs && startMs < due ? due + (toMs - startMs) : due;
    }, anchorMs + waitMs);

/** How long the clock actually ran between `anchorMs` and `nowMs`. */
export const runningMs = (
  anchorMs: number,
  nowMs: number,
  stops: readonly ClockStop[],
): number =>
  stops
    .map((stop) => spanOf(stop, nowMs))
    .reduce(
      (running, { fromMs, toMs }) =>
        running -
        Math.max(0, Math.min(toMs, nowMs) - Math.max(fromMs, anchorMs)),
      nowMs - anchorMs,
    );
