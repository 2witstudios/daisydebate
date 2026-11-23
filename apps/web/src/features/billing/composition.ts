import { createBillingNativeResolver } from './native-resolver';
import { composeBillingWebhook } from './webhook-route';
import { defineComposition } from '../../server/composition';
import { memberHttpBoundary } from '../auth/member-boundary';
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
