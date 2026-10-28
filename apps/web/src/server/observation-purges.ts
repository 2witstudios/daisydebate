import type { Clock } from '@daisy/clock';
import type { createDatabase } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import { createRetentionSweep, startRetentionSweep } from './retention-sweep';
import type { WorkerTimers } from '../lib/worker-timers';

/** How often due observation purge jobs are delivered (ISSUE-852). */
const OBSERVATION_PURGE_INTERVAL_MS = 5_000;
const OBSERVATION_PURGE_BATCH = 128;

/**
 * Delivers durable observation purge jobs (ISSUE-852, ADR 0089): each run
 * purges every cached observation body once for all due jobs and records
 * success only after Redis confirms; a failure leaves the jobs pending with
 * backoff, and the next run retries them.
 */
export function startObservationPurges(input: {
  readonly deliver: ReturnType<
    typeof createDatabase
  >['deliverObservationPurges'];
  readonly purgeAll: () => Promise<unknown>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly timers: WorkerTimers;
  readonly intervalMs?: number;
}) {
  const sweep = createRetentionSweep({
    clock: input.clock,
    logger: input.logger,
    targets: [
      {
        name: 'retention.observation_purges',
        batchSize: OBSERVATION_PURGE_BATCH,
        maxBatches: 1,
        purge: async ({ now, limit }) => {
          const result = await input.deliver(
            { now, limit },
            { purge: async () => void (await input.purgeAll()) },
          );
          return result.succeeded;
        },
      },
    ],
  });
  return startRetentionSweep({
    sweep,
    timers: input.timers,
    intervalMs: input.intervalMs ?? OBSERVATION_PURGE_INTERVAL_MS,
    runOnStart: true,
  });
}
