import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_MAX_CONNECTIONS } from '@daisy/db';
import type { Logger } from '@daisy/logger';

/**
 * Handed-off tasks running at once. Each holds at most one database
 * connection at a time (its lookup, suppression check, receipt write and
 * token delete run one after another), so 4 of the pool's 10 leave the
 * rest to the requests being answered. Four provider requests in flight
 * stay under Resend's default 10 requests a second at its usual latency;
 * a 429 from it is a transient failure the sender retries once.
 */
export const AFTER_RESPONSE_MAX_RUNNING = Math.floor(
  (DEFAULT_MAX_CONNECTIONS * 2) / 5,
);

/**
 * Handed-off tasks waiting for a running slot. A task takes about one
 * provider round trip (well under a second), so the running slots clear a
 * full queue in (4 + 64) / 4 = 17 round trips, inside the shutdown drain
 * (`start.ts`) with room to spare.
 */
export const AFTER_RESPONSE_MAX_QUEUED = 64;

/** Work an auth request hands off so that its answer never waits on it. */
type Work = () => Promise<void>;

/** Queues `work` to start once the current request has been answered. */
export type AfterResponse = (work: Work) => void;

/**
 * Work that runs after the auth handler has produced its answer (ISSUE-185):
 * `around` runs one request and, once its handler has returned or thrown,
 * starts the work that request queued with `defer`. Work queued outside a
 * request (a direct `auth.api` call) starts at once, and the caller is still
 * not made to wait on it. At most AFTER_RESPONSE_MAX_RUNNING pieces of work
 * run at once and AFTER_RESPONSE_MAX_QUEUED wait; a piece arriving past
 * both is shed before it starts (so before any account lookup, whatever
 * the address), logged as `auth.mail.shed` with the backlog's size, and its
 * unmailed token expires unused (DEC-73). `settled` resolves when every
 * running and waiting piece has finished, so a shutdown can wait for it
 * before the pools close. Work logs its own delivery failures. One that
 * still rejects (a database outage during a saturated request's account
 * lookup or token delete) is logged without its error, as the auth handler
 * logs one, never an unhandled rejection; its unmailed token expires
 * unused.
 */
export type AfterResponseLimits = {
  readonly maxRunning: number;
  readonly maxQueued: number;
};

export function createAfterResponse(
  logger: Logger,
  limits: AfterResponseLimits = {
    maxRunning: AFTER_RESPONSE_MAX_RUNNING,
    maxQueued: AFTER_RESPONSE_MAX_QUEUED,
  },
) {
  const queues = new AsyncLocalStorage<Work[]>();
  const running = new Set<Promise<void>>();
  const waiting: Work[] = [];
  const pending = () => running.size + waiting.length;
  const run = (work: Work) => {
    const task: Promise<void> = Promise.resolve()
      .then(work)
      .catch(() =>
        logger.log(
          'request.unhandled',
          { source: 'auth.after-response' },
          'Authentication work after the answer failed',
        ),
      )
      .finally(() => {
        running.delete(task);
        const next = waiting.shift();
        if (next) run(next);
      });
    running.add(task);
  };
  const start = (work: Work) => {
    if (running.size < limits.maxRunning) run(work);
    else if (waiting.length < limits.maxQueued) waiting.push(work);
    else
      logger.log(
        'auth.mail.shed',
        { operation: 'auth.after-response', pending: pending() },
        'Auth work after the answer was shed; its backlog is full',
      );
  };
  const defer: AfterResponse = (work) => {
    const queue = queues.getStore();
    if (queue) queue.push(work);
    else start(work);
  };
  const around = async <T>(request: () => Promise<T>): Promise<T> => {
    const queue: Work[] = [];
    try {
      return await queues.run(queue, request);
    } finally {
      for (const work of queue.splice(0)) start(work);
    }
  };
  const settled = async () => {
    while (running.size > 0) await Promise.allSettled([...running]);
  };
  return { defer, around, settled, pending };
}
