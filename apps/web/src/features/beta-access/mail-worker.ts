import type { Waits } from '@daisy/clock';
import type { ErrorReporter } from '@daisy/observability';
import { createMailIntentDelivery } from './mail-delivery';
import { startMailQueueWorker } from '../mail/queue-worker';
import { MAIL_QUEUE_BATCH } from '../mail/retry-policy';
import type { App } from '../../server/app';
import { workerFailures } from '../../server/recoverable-failure';
import { nextWorkerToken } from '../../server/worker-token';

/**
 * The durable beta mail worker (ADR 0075): every web instance runs it, and
 * the mail intent leases keep instances off each other's mail.
 */
export function startBetaMail(input: {
  readonly app: App;
  readonly waits: Waits;
  readonly reporter?: ErrorReporter;
}) {
  const { app } = input;
  const failed = workerFailures(app, input.reporter)(
    'beta.mail.failed',
    'beta.mail',
    'Beta mail stays queued',
  );
  return startMailQueueWorker({
    run: (limit) =>
      createMailIntentDelivery({
        store: app.database,
        deliver: (message) => app.deliverMail('beta-access')(message),
        ownerAddress: app.config.BETA_NOTIFY_EMAIL,
        appUrl: app.config.PUBLIC_APP_URL,
        nextToken: nextWorkerToken,
        now: () => app.clock.now(),
        failed: (error) => failed(error, 'decide'),
      }).run(limit),
    batch: MAIL_QUEUE_BATCH,
    everyMs: 15_000,
    waits: input.waits,
    failed: (error) => failed(error, 'send'),
  });
}
