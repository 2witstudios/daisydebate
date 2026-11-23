import type { SQL } from 'bun';
import type { Waits } from '@daisy/clock';
import { createLane } from './workload';

/**
 * A competitive lane over a test's own pool: `connections` admitted
 * connections (a bounded writer weighs two), waiting at most `waitMs` on
 * `waits`.
 */
export const testLane = (
  client: SQL,
  waits: Waits,
  connections: number,
  waitMs = 1000,
) =>
  createLane(
    'competitive',
    client,
    { connections, queue: 64, maxWaitMs: waitMs },
    { waits },
  );
