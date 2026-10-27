/** Process-edge timers used by independent control and judging lifecycles. */
export type WorkerTimers = {
  readonly setInterval: (task: () => Promise<void>, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};
