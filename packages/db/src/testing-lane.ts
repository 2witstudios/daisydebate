import type { SQL } from 'bun';
import { createLane } from './workload';

/**
 * A competitive lane over a test's own pool: `connections` admitted
 * connections (a bounded writer weighs two), waiting at most `waitMs`.
 */
export const testLane = (client: SQL, connections: number, waitMs = 1000) =>
  createLane('competitive', client, {
    connections,
    queue: 64,
    maxWaitMs: waitMs,
  });
