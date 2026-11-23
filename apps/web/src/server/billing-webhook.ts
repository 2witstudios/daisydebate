import { deadlineSignal, type Waits } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { App } from './app';
import { createBillingWebhook } from '../features/billing/webhook-handler';
import { workerFailures } from './recoverable-failure';
import { hostingPurchaseDependencies } from './hosting-purchases';
import { settleHostingPurchase } from '../features/hosting-purchases/checkout';

/** How long a delivery's body may take to arrive. */
const BODY_DEADLINE_MS = 5_000;

/**
 * A durable receipt is independent of purchase release; no vendor body/error
 * enters telemetry. Each delivery's body deadline runs on `waits` (R4.7).
 */
export function composeBillingWebhook(
  app: App,
  fetch: typeof globalThis.fetch,
  waits: Waits,
) {
  const failed = workerFailures(app, app.reporter)(
    'billing.webhook.failed',
    'billing.webhook',
    'Verified billing receipt remains undelivered',
  );
  const settleHosting = settleHostingPurchase(
    hostingPurchaseDependencies(app, fetch),
  );
  return async (request: Request) => {
    const deadline = deadlineSignal(waits, BODY_DEADLINE_MS, request.signal);
    try {
      return await createBillingWebhook({
        settleHosting,
        config: app.config.billing,
        clock: app.clock,
        receive: app.database.receiveBillingReceipt,
        deadline: () => deadline.signal,
        failed: () => failed(createAppError('INFRASTRUCTURE'), 'receive'),
      })(request);
    } finally {
      deadline.clear();
    }
  };
}
