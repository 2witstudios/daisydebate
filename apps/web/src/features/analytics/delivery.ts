import type { AnalyticsMessage } from './server-adapter';
import { createAppError } from '@daisy/errors';

/** Optional telemetry owns a small bounded queue; it never borrows auth's capacity. */
export function createAnalyticsDelivery({
  deliver,
  maxRunning = 4,
  maxQueued = 32,
}: {
  readonly deliver: (message: AnalyticsMessage) => Promise<void>;
  readonly maxRunning?: number;
  readonly maxQueued?: number;
}) {
  if (
    !Number.isSafeInteger(maxRunning) ||
    maxRunning < 1 ||
    !Number.isSafeInteger(maxQueued) ||
    maxQueued < 0
  )
    throw createAppError('VALIDATION');
  const running = new Set<Promise<void>>();
  const waiting: AnalyticsMessage[] = [];
  let closed = false;
  const start = (message: AnalyticsMessage) => {
    const task = Promise.resolve()
      .then(() => deliver(message))
      .catch(() => {})
      .finally(() => {
        running.delete(task);
        const next = waiting.shift();
        if (next && !closed) start(next);
      });
    running.add(task);
  };
  const settled = async () => {
    while (running.size > 0) await Promise.all(running);
  };
  return {
    settled,
    enqueue(message: AnalyticsMessage): boolean {
      if (closed) return false;
      if (running.size < maxRunning) {
        start(message);
        return true;
      }
      if (waiting.length >= maxQueued) return false;
      waiting.push(message);
      return true;
    },
    async close() {
      closed = true;
      waiting.length = 0;
      await settled();
    },
  };
}
