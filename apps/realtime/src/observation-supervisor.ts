type Runtime = {
  readonly start: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly connect: (...args: never[]) => unknown;
};

/** Owns the process's observation runtime. Clock uncertainty cannot be
 * repaired in place: the old runtime fails closed, sockets are told to
 * reconnect, and a fresh runtime (new clock and node incarnation) replaces
 * it. Readiness is false until the replacement is live.
 */
export function createObservationSupervisor<R extends Runtime>({
  create,
  onRestart,
  retry,
}: {
  readonly create: (onUncertainty: () => void) => R;
  /** Closes current sockets so clients reconnect to the replacement. */
  readonly onRestart: () => void;
  /** Schedules another replacement attempt after a failed start. */
  readonly retry: (work: () => void) => void;
}) {
  let current: R | null = null,
    generation = 0,
    ready = false,
    closed = false;
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
    if (attempt === generation && !closed) ready = true;
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
      if (!current) throw new Error('Observation runtime unavailable');
      return current.connect(...(args as never[])) as ReturnType<R['connect']>;
    },
    async close() {
      if (closed) return;
      closed = true;
      ready = false;
      await current?.close();
    },
  };
}
