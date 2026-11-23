/**
 * When a held conversation refresh has finished: once a route read of the
 * page has finished arriving after the refresh asked and no refresh
 * transition is running. A discarded held refresh ends its transition while
 * its read is still on the wire, and a prefetch of the page can finish while
 * the refresh is still running; neither alone settles it. A read that is
 * never recorded (a failed or aborted fetch has no Resource Timing entry) is
 * settled after `limitMs`.
 */
export function createRefreshSettlement(input: {
  readonly wait: (run: () => void, ms: number) => () => void;
  readonly limitMs: number;
  readonly settled: () => void;
}) {
  let flight: { readArrived: boolean; readonly cancel: () => void } | null =
    null;
  let running = false;
  const settle = () => {
    if (flight === null) return;
    flight.cancel();
    flight = null;
    input.settled();
  };
  const settleWhenDone = () => {
    if (flight?.readArrived && !running) settle();
  };
  return {
    /** A refresh has asked; any earlier one is forgotten. */
    asked: () => {
      flight?.cancel();
      flight = {
        readArrived: false,
        cancel: input.wait(settle, input.limitMs),
      };
    },
    /** A route read of this page has finished arriving. */
    readFinished: () => {
      if (flight === null) return;
      flight.readArrived = true;
      settleWhenDone();
    },
    /** Whether a refresh transition is running, as last rendered. */
    transitionRan: (isRunning: boolean) => {
      running = isRunning;
      settleWhenDone();
    },
    dispose: () => {
      flight?.cancel();
      flight = null;
    },
  };
}
