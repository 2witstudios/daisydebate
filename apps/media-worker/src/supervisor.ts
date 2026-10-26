type Session = { readonly roundId: string; readonly sessionId: string };
/**
 * A capture process's exit status when the server definitely closed its
 * session (a terminal Round): the session is finished and never relaunched.
 */
export const CAPTURE_FINISHED_EXIT = 3;
type Scope = Session & { readonly workerId: string };
type Process = { readonly exited: Promise<number>; readonly stop: () => void };

/**
 * One capture process per discovered session, up to capacity. Discovery is
 * advisory; the process itself claims the lease through the signed web path.
 * A fresh worker id per launch means a relaunch takes an expired lease over
 * at a new epoch rather than reusing a crashed process's authority.
 */
export function createCaptureSupervisor(input: {
  readonly maxSessions: number;
  readonly retryMs: { readonly initial: number; readonly max: number };
  readonly nowMs: () => number;
  readonly nextWorkerId: () => string;
  readonly discover: (limit: number) => Promise<readonly Session[]>;
  readonly launch: (scope: Scope) => Process;
  readonly failed: (status: number) => void;
}) {
  const running = new Map<string, Process>();
  const backoff = new Map<string, { failures: number; retryAt: number }>();
  // Sessions the server definitely closed: never relaunched. Bounded, oldest first.
  const finished = new Set<string>();
  let stopped = false;
  const exited = (sessionId: string, status: number) => {
    running.delete(sessionId);
    if (status === CAPTURE_FINISHED_EXIT) {
      backoff.delete(sessionId);
      if (finished.size >= 4096)
        finished.delete(finished.values().next().value!);
      finished.add(sessionId);
      return;
    }
    if (status === 0) {
      backoff.delete(sessionId);
      return;
    }
    input.failed(status);
    const failures = (backoff.get(sessionId)?.failures ?? 0) + 1;
    backoff.delete(sessionId);
    // Bounded: the oldest retry record goes first.
    if (backoff.size >= 1024) backoff.delete(backoff.keys().next().value!);
    backoff.set(sessionId, {
      failures,
      retryAt:
        input.nowMs() +
        Math.min(
          input.retryMs.max,
          input.retryMs.initial * 2 ** (failures - 1),
        ),
    });
  };
  return {
    async tick() {
      const capacity = input.maxSessions - running.size;
      if (stopped || capacity <= 0) return;
      const found = await input.discover(Math.min(64, capacity + backoff.size));
      const now = input.nowMs();
      for (const session of found) {
        if (stopped || running.size >= input.maxSessions) return;
        const retry = backoff.get(session.sessionId);
        if (
          running.has(session.sessionId) ||
          finished.has(session.sessionId) ||
          (retry && now < retry.retryAt)
        )
          continue;
        const process = input.launch({
          ...session,
          workerId: input.nextWorkerId(),
        });
        running.set(session.sessionId, process);
        void process.exited.then(
          (status) => exited(session.sessionId, status),
          () => exited(session.sessionId, 1),
        );
      }
    },
    async stop() {
      stopped = true;
      const draining = [...running.values()];
      for (const process of draining) process.stop();
      await Promise.allSettled(draining.map((process) => process.exited));
    },
  };
}
