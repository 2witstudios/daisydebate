/**
 * Process-edge interval timers for every in-process worker loop: Round bots,
 * AI judging, Round analysis, beta mail and the retention sweep. Injected at
 * the edge (server/start.ts) so each loop is driven by fake timers in tests.
 */
export type WorkerTimers = {
  readonly setInterval: (task: () => Promise<void>, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};
