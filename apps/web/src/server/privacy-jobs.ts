import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { createAppError } from '@daisy/errors';
import type { DuePrivacyJob, PrivacyVendor } from '@daisy/db/privacy';
import { createRetentionSweep, startRetentionSweep } from './retention-sweep';
import type { App } from './app';
import type { WorkerTimers } from '../lib/worker-timers';

/**
 * The vendors this deployment both queues on erasure and can deliver
 * (ISSUE-833, ADR 0087): a processor holds subject data only once it is
 * wired, and a queued job no port can deliver would retry forever while
 * recording a deletion that never happened. `messaging-typing` is the one
 * unconditional vendor here. Configured PostHog adds its port and admission
 * together; object storage has its own file-deletion worker. Other planned
 * processors stay absent until their delivery ports exist (ADR 0037).
 */
export const privacyJobVendors = ['messaging-typing'] as const;

export const configuredPrivacyJobVendors = (
  app: App,
): readonly PrivacyVendor[] =>
  app.posthogErasure ? [...privacyJobVendors, 'posthog'] : privacyJobVendors;

/**
 * The vendor deletion port a queued job is delivered through: the Redis
 * typing-lease erasure for `messaging-typing`. Any other vendor is a
 * composition error and refuses loudly, so a job is never silently stranded.
 */
export const privacyJobPort = (
  app: App,
  vendor: PrivacyVendor,
): { readonly erase: (subjectRef: string) => Promise<void> } => {
  if (vendor === 'posthog')
    return (
      app.posthogErasure ?? {
        erase: async () => {
          throw createAppError('INFRASTRUCTURE');
        },
      }
    );
  if (vendor !== 'messaging-typing') throw createAppError('INFRASTRUCTURE');
  return app.database.messagingTypingPrivacyPort({
    exportSubject: (actorId) => app.redis.exportSubjectTyping(actorId),
    eraseSubject: (actorId) => app.redis.eraseSubjectTyping(actorId),
  });
};

/** How often due vendor deletion jobs are delivered (ISSUE-833). */
const PRIVACY_JOBS_INTERVAL_MS = 60_000;
const PRIVACY_JOBS_BATCH = 32;
const PRIVACY_JOBS_RETRY_MS = 60_000;
const PRIVACY_JOBS_RETRY_MAX_MS = 3_600_000;

/** A failed vendor deletion tries again later, doubling its wait from one
 * minute, at most hourly. The obligation stays pending until the vendor
 * confirms; nothing about the failure is stored or logged beyond counts.
 */
const privacyJobRetryAt = (now: string, attempts: number): string =>
  new Date(
    new Date(now).getTime() +
      Math.min(
        PRIVACY_JOBS_RETRY_MS * 2 ** Math.max(0, attempts),
        PRIVACY_JOBS_RETRY_MAX_MS,
      ),
  ).toISOString();

/**
 * Delivers durable vendor deletion jobs (ADR 0087, ISSUE-833): each run
 * reads one bounded batch of due `privacy_jobs`, oldest first, and delivers
 * each through its vendor's port — `deliver` owns claiming, the vendor call
 * and recording success. A vendor failure leaves the job pending with
 * backoff; the next run retries it. The sweep logs counts only, never
 * subjects or vendor errors.
 */
export function startPrivacyJobs(input: {
  readonly due: (batch: {
    readonly now: string;
    readonly limit: number;
  }) => Promise<readonly DuePrivacyJob[]>;
  readonly deliver: (
    job: DuePrivacyJob,
    now: string,
    retryAt: string,
  ) => Promise<'idle' | 'retry' | 'succeeded'>;
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
        name: 'retention.privacy_jobs',
        batchSize: PRIVACY_JOBS_BATCH,
        maxBatches: 1,
        purge: async ({ now, limit }) => {
          const jobs = await input.due({ now, limit });
          let delivered = 0;
          for (const job of jobs) {
            const outcome = await input.deliver(
              job,
              now,
              privacyJobRetryAt(now, job.attempts),
            );
            if (outcome === 'succeeded') delivered += 1;
          }
          return delivered;
        },
      },
    ],
  });
  return startRetentionSweep({
    sweep,
    timers: input.timers,
    intervalMs: input.intervalMs ?? PRIVACY_JOBS_INTERVAL_MS,
    runOnStart: true,
  });
}
