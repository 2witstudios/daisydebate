/**
 * Monotonic time and cancellable waits: the resource timed server code takes
 * (R4.7). A wait resolves when it is due, or at once when its signal aborts;
 * it never rejects, so a stopped wait reads `signal.aborted`. Production gets
 * the host implementation from `@daisy/worker/host` at a process entry; a
 * test hands `virtualClock` from `@daisy/clock/testing`.
 */
export type Waits = {
  /** Monotonic milliseconds; only differences between readings mean anything. */
  readonly nowMs: () => number;
  /** Resolves `ms` from now, or at once when `signal` aborts. */
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Resolves at `dueMs` on the `nowMs` scale, or at once when `signal` aborts. */
  readonly waitUntilMs: (dueMs: number, signal?: AbortSignal) => Promise<void>;
};
