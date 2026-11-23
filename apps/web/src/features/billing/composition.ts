import { createBillingNativeResolver } from '../../server/billing-app';
import { composeBillingWebhook } from '../../server/billing-webhook';
import { defineComposition } from '../../server/composition';
import { memberHttpBoundary } from '../../server/member-boundary';
import { composeBillingRoutes } from './native-composition';

const native = createBillingNativeResolver();

/** billing: checkout, portal and settings bind here (`processRoute`). */
export const billingComposition = defineComposition(
  'billing',
  (app, { vendorFetch }) =>
    composeBillingRoutes({
      boundary: memberHttpBoundary(app),
      runtime: () => native(app, vendorFetch),
    }),
);

/** billing-webhook: Stripe's signed deliveries bind here. */
export const billingWebhookComposition = defineComposition(
  'billing-webhook',
  (app, { vendorFetch }) => ({
    POST: composeBillingWebhook(app, vendorFetch, app.waits),
  }),
);
