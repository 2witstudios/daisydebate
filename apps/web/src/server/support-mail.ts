import type { ErrorReporter } from '@daisy/observability';
import { supportOwnerAddress } from '../features/support/owner-address';
import { createSupportMessageNotices } from '../features/support/owner-notice';
import { startMailQueueWorker } from '../features/mail/queue-worker';
import { MAIL_QUEUE_BATCH } from '../features/mail/retry-policy';
import type { WorkerTimers } from '../lib/worker-timers';
import type { App } from './app';
import { workerFailures } from './recoverable-failure';
import { nextWorkerToken } from './worker-token';

/**
 * The support message email worker (SUPP-1): every web instance runs it,
 * and the notice leases keep instances off each other's mail. The address
 * is support's own, else the beta owner address; with neither it does not
 * run, so messages stay stored and their email waits queued until one is
 * set; the start says so once.
 */
export function startSupportMail(input: {
  readonly app: App;
  readonly timers: WorkerTimers;
  readonly reporter?: ErrorReporter;
}) {
  const { app } = input;
  const ownerAddress = supportOwnerAddress(app.config);
  if (!ownerAddress) {
    app.logger.log(
      'support.mail.unconfigured',
      { operation: 'support.mail' },
      'Support email waits: no owner address is configured',
    );
    return null;
  }
  const sinks = workerFailures(app, input.reporter);
  const failed = sinks(
    'support.mail.failed',
    'support.mail',
    'Support email stays queued',
  );
  // A notice lost for good is reported at once: capacity deferral is only
  // for work a later tick will retry.
  const gaveUp = sinks(
    'support.mail.failed',
    'support.mail',
    'Support email failed for good',
    undefined,
    { terminal: true },
  );
  return startMailQueueWorker({
    run: (limit) =>
      createSupportMessageNotices({
        store: app.database,
        deliver: (message) => app.deliverMail('support')(message),
        ownerAddress,
        nextToken: nextWorkerToken,
        now: () => app.clock.now(),
        failed: (error) => failed(error, 'decide'),
        gaveUp: (error) => gaveUp(error, 'gave_up'),
      }).run(limit),
    batch: MAIL_QUEUE_BATCH,
    everyMs: 15_000,
    timers: input.timers,
    failed: (error) => failed(error, 'send'),
  });
}
