import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';

/** The recurring deliveries of owed work. Not retention targets (ISSUE-1007). */
export const SCHEDULED_WORKERS = [
  'observation_purges',
  'privacy_jobs',
  'messaging_file_maintenance',
] as const;
export type ScheduledWorkerName = (typeof SCHEDULED_WORKERS)[number];

export const isScheduledWorker = (
  value: unknown,
): value is ScheduledWorkerName =>
  (SCHEDULED_WORKERS as readonly unknown[]).includes(value);

/**
 * What one pass did and what it still owes. `owed` counts jobs that failed
 * and sit in backoff, including any this pass just retried.
 */
export type WorkerPass = {
  readonly delivered: number;
  readonly retried: number;
  readonly owed: number;
};

type WorkerOutcome = 'failed' | 'waiting' | 'healthy';

/**
 * A retried job backs off, so the next passes find nothing due. Those idle
 * passes are `waiting`, not `healthy`: counting them as success would refresh
 * the alert marker between retries, and an outage could never fire its alert.
 */
export const workerOutcome = (pass: WorkerPass): WorkerOutcome => {
  if (pass.retried > 0) return 'failed';
  return pass.owed > 0 ? 'waiting' : 'healthy';
};

/**
 * One run of one worker. Only a healthy pass logs `worker.run.completed`, the
 * event its alert marker reads; a failed pass or a thrown one logs
 * `worker.run.failed`; a waiting pass logs nothing. Counts and a stable error
 * code only, never subjects or the error.
 */
export function createScheduledWorker({
  name,
  pass,
  clock,
  logger,
}: {
  readonly name: ScheduledWorkerName;
  readonly pass: (now: string) => Promise<WorkerPass>;
  readonly clock: Clock;
  readonly logger: Logger;
}) {
  const failed = (counts: { delivered: number; retried: number }) =>
    logger.log(
      'worker.run.failed',
      { operation: name, errorCode: 'INFRASTRUCTURE', ...counts },
      'Scheduled worker run failed',
    );
  return {
    async run(): Promise<void> {
      let result: WorkerPass;
      try {
        result = await pass(clock.now());
      } catch {
        failed({ delivered: 0, retried: 0 });
        return;
      }
      const { delivered, retried } = result;
      const outcome = workerOutcome(result);
      if (outcome === 'failed') failed({ delivered, retried });
      if (outcome === 'healthy')
        logger.log(
          'worker.run.completed',
          { operation: name, delivered },
          'Scheduled worker run completed',
        );
    },
  };
}
