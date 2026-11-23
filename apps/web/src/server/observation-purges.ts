import type { Waits } from '@daisy/clock';
import { passOf, pollWork } from '@daisy/worker';
import { HOUSEKEEPING_IDLE_MAX_MS } from '../lib/worker-idle';
import type { Clock } from '@daisy/clock';
import type { createDatabase } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import { createScheduledWorker } from '../features/ops/scheduled-worker';

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
  readonly waits: Waits;
  readonly intervalMs?: number;
}) {
  const worker = createScheduledWorker({
    name: 'observation_purges',
    clock: input.clock,
    logger: input.logger,
    pass: async (now) => {
      const { succeeded, retried } = await input.deliver(
        { now, limit: OBSERVATION_PURGE_BATCH },
        { purge: async () => void (await input.purgeAll()) },
      );
      return { deleted: succeeded, retried, owed: await input.owed() };
    },
  });
  const busyMs = input.intervalMs ?? OBSERVATION_PURGE_INTERVAL_MS;
  // Its alert reads a completion within 15 minutes; the idle cap is well inside.
  const loop = pollWork({
    pass: () => worker.run().then(passOf),
    backoff: {
      busyMs,
      idleMaxMs: Math.max(busyMs, HOUSEKEEPING_IDLE_MAX_MS),
    },
    waits: input.waits,
    failed: () => undefined,
  });
  return { initial: loop.started, stop: loop.stop };
}
