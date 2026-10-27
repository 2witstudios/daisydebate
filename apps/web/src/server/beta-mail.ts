import type { ErrorReporter } from '@daisy/observability';
import { createMailIntentDelivery } from '../features/beta-access/mail-delivery';
import { startMailIntentService } from '../features/beta-access/mail-service';
import type { WorkerTimers } from '../features/round-bots/worker-timers';
import type { App } from './app';
import { workerFailures } from './recoverable-failure';
import { nextWorkerToken } from './worker-token';

/**
 * The durable beta mail worker (ADR 0075): every web instance runs it, and
 * the mail intent leases keep instances off each other's mail.
 */
export function startBetaMail(input: {
  readonly app: App;
  readonly timers: WorkerTimers;
  readonly reporter?: ErrorReporter;
}) {
  const { app } = input;
  const failed = workerFailures(app, input.reporter)(
    'beta.mail.failed',
    'beta.mail',
    'Beta mail stays queued',
  );
  return startMailIntentService({
    run: (limit) =>
      createMailIntentDelivery({
        store: app.database,
        deliver: (message) => app.deliverMail()(message),
        ownerAddress: app.config.BETA_NOTIFY_EMAIL,
        appUrl: app.config.PUBLIC_APP_URL,
        nextToken: nextWorkerToken,
        now: () => app.clock.now(),
        failed: (error) => failed(error, 'decide'),
      }).run(limit),
    batch: 10,
    everyMs: 15_000,
    timers: input.timers,
    failed: (error) => failed(error, 'send'),
  });
}
