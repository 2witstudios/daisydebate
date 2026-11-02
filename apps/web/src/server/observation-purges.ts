import type { Clock } from '@daisy/clock';
import type { createDatabase } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import { createScheduledWorker } from '../features/ops/scheduled-worker';
import { startRunSchedule } from './run-schedule';
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
  readonly owed: ReturnType<typeof createDatabase>['owedObservationPurges'];
  readonly purgeAll: () => Promise<unknown>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly timers: WorkerTimers;
  readonly intervalMs?: number;
}) {
  return startRunSchedule({
    work: createScheduledWorker({
      name: 'observation_purges',
      clock: input.clock,
      logger: input.logger,
      pass: async (now) => {
        const { succeeded, retried } = await input.deliver(
          { now, limit: OBSERVATION_PURGE_BATCH },
          { purge: async () => void (await input.purgeAll()) },
        );
        return { delivered: succeeded, retried, owed: await input.owed() };
      },
    }),
    timers: input.timers,
    intervalMs: input.intervalMs ?? OBSERVATION_PURGE_INTERVAL_MS,
    runOnStart: true,
  });
}
