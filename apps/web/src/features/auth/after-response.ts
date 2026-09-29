import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from '@daisy/logger';

/** Work an auth request hands off so that its answer never waits on it. */
type Work = () => Promise<void>;

/** Queues `work` to start once the current request has been answered. */
export type AfterResponse = (work: Work) => void;

/**
 * Work that runs after the auth handler has produced its answer (ISSUE-185):
 * `around` runs one request and, once its handler has returned or thrown,
 * starts the work that request queued with `defer`. Work queued outside a
 * request (a direct `auth.api` call) starts at once, and the caller is still
 * not made to wait on it. `settled` resolves when every started piece of
 * work has finished, so a shutdown can wait for it before the pools close.
 * Work logs its own delivery failures. One that still rejects (a database
 * outage during a saturated request's account lookup or token delete) is
 * logged without its error, as the auth handler logs one, never an
 * unhandled rejection; its unmailed token expires unused.
 */
export function createAfterResponse(logger: Logger) {
  const queues = new AsyncLocalStorage<Work[]>();
  const running = new Set<Promise<void>>();
  const start = (work: Work) => {
    const task = Promise.resolve()
      .then(work)
      .catch(() =>
        logger.log(
          'request.unhandled',
          { source: 'auth.after-response' },
          'Authentication work after the answer failed',
        ),
      )
      .finally(() => running.delete(task));
    running.add(task);
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
  return { defer, around, settled };
}
