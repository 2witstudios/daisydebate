import { createAppError } from '@daisy/errors';
import type { App } from './app';
import { createBillingWebhook } from '../features/billing/webhook-handler';
import { workerFailures } from './recoverable-failure';

/** A durable receipt is independent of purchase release; no vendor body/error enters telemetry. */
export function composeBillingWebhook(app: App) {
  const failed = workerFailures(app, app.reporter)(
    'billing.webhook.failed',
    'billing.webhook',
    'Verified billing receipt remains undelivered',
  );
  return (request: Request) =>
    createBillingWebhook({
      config: app.config.billing,
      clock: app.clock,
      receive: app.database.receiveBillingReceipt,
      deadline: () =>
        AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
      failed: () => failed(createAppError('INFRASTRUCTURE'), 'receive'),
    })(request);
}
