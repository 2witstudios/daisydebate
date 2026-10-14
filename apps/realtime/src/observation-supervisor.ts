type Runtime = {
  readonly start: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly connect: (...args: never[]) => unknown;
  readonly hint: (frame: never) => void;
};

/** Owns the process's observation runtime. Clock uncertainty cannot be
 * repaired in place: the old runtime fails closed, sockets are told to
 * reconnect, and a fresh runtime (new clock and node incarnation) replaces
 * it. Readiness is false until the replacement is live.
 */
export function createObservationSupervisor<R extends Runtime>({
  create,
  unavailable,
  onRestart,
  retry,
}: {
  readonly create: (onUncertainty: () => void) => R;
  /** A connection whose observations answer unavailable, used while no
   * runtime is live; a socket is never left without one. */
  readonly unavailable: (
    ...args: Parameters<R['connect']>
  ) => ReturnType<R['connect']>;
  /** Closes current sockets so clients reconnect to the replacement. */
  readonly onRestart: () => void;
  /** Schedules another replacement attempt after a failed start. */
  readonly retry: (work: () => void) => void;
}) {
  let current: R | null = null,
    generation = 0,
    ready = false,
    closed = false,
    stranded = 0;
  async function launch() {
    const attempt = ++generation;
    const runtime = create(() => uncertain(attempt));
    current = runtime;
    try {
      await runtime.start();
    } catch (error) {
      if (attempt === generation) current = null;
      await runtime.close();
      throw error;
    }
    if (attempt !== generation || closed) return;
    ready = true;
    // Sockets that arrived during the gap hold unavailable connections:
    // close them so they reconnect to the live runtime.
    if (stranded) {
      stranded = 0;
      onRestart();
    }
  }
  function relaunch() {
    if (closed) return;
    void launch().catch(() => {
      if (!closed) retry(relaunch);
    });
  }
  function uncertain(attempt: number) {
    if (closed || attempt !== generation) return;
    ready = false;
    generation++;
    const old = current;
    current = null;
    void old?.close();
    onRestart();
    relaunch();
  }
  return {
    start: launch,
    ready: () => ready && !closed,
    connect(...args: Parameters<R['connect']>): ReturnType<R['connect']> {
      if (!current || !ready) {
        stranded++;
        return unavailable(...args);
      }
      return current.connect(...(args as never[])) as ReturnType<R['connect']>;
    },
    /** Lossy hints reach only a live runtime; a gap drops them. */
    hint(frame: Parameters<R['hint']>[0]) {
      if (current && ready && !closed) current.hint(frame as never);
    },
    async close() {
      if (closed) return;
      closed = true;
      ready = false;
      await current?.close();
    },
  };
}
