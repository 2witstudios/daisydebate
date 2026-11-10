import type { ErrorReporter } from '@daisy/observability';
import { startMailQueueWorker } from '../features/mail/queue-worker';
import { createNotificationEmailDelivery } from '../features/notifications/email/delivery';
import { deriveUnsubscribeSubkey } from '../features/notifications/email/unsubscribe-token';
import type { WorkerTimers } from '../lib/worker-timers';
import type { App } from './app';
import { workerFailures } from './recoverable-failure';
import { nextWorkerToken } from './worker-token';

/**
 * The notification email worker (ADR 0124): every web instance runs it, and
 * the job leases keep instances off each other's mail.
 */
export function startNotificationMail(input: {
  readonly app: App;
  readonly timers: WorkerTimers;
  readonly reporter?: ErrorReporter;
}) {
  const { app } = input;
  const failed = workerFailures(app, input.reporter)(
    'notification.mail.failed',
    'notification.mail',
    'Notification email stays queued',
  );
  return startMailQueueWorker({
    run: (limit) =>
      createNotificationEmailDelivery({
        store: app.database,
        deliver: (message) => app.deliverMail('notification')(message),
        appUrl: app.config.PUBLIC_APP_URL,
        unsubscribeSubkey: deriveUnsubscribeSubkey(
          app.mailConfig().RECIPIENT_HASH_SECRET,
        ),
        nextToken: nextWorkerToken,
        now: () => app.clock.now(),
        failed: (error) => failed(error, 'decide'),
      }).run(limit),
    batch: 10,
    everyMs: 5_000,
    timers: input.timers,
    failed: (error) => failed(error, 'send'),
  });
}
