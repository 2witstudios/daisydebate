import type Stripe from 'stripe';
import {
  canManageBilling,
  canPurchasePremium,
} from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { aiAdmissionOptions } from '../../server/round-worker-policy';
import { releaseAdmission } from '../flags/admission';
import { createRequestFlagReader } from '../flags/reader';
import { isReleaseEnabled } from '../flags/server';
import { createPurchaseAdmission } from './purchase-admission';
import { stripeCheckoutPort } from './checkout-vendor';
import { stripePortalPort } from './portal-session';
import {
  createNativeBillingRuntime,
  type NativeBillingVendor,
} from './native-runtime';

/** The process edge owns the Stripe instance; native operations own only their published ports. */
export function composeNativeBilling(
  app: App,
  stripe: Pick<Stripe, 'checkout' | 'billingPortal'> | null,
) {
  const config = app.config.billing;
  if (config.kind === 'stripe' && stripe === null)
    throw createAppError(
      'INFRASTRUCTURE',
      'Billing vendor transport is unavailable',
    );
  const vendor: NativeBillingVendor =
    config.kind === 'stripe' && stripe !== null
      ? {
          kind: 'stripe',
          config,
          checkout: stripeCheckoutPort(stripe),
          portal: stripePortalPort(stripe),
        }
      : { kind: 'disabled' };
  const allowance = aiAdmissionOptions(app.config).aiAllowance;
  if (!allowance)
    throw createAppError(
      'INVARIANT',
      'Billing allowance policy is unavailable',
    );
  const purchaseStore = app.database.billingPurchases({
    purchase: canPurchasePremium,
    manage: canManageBilling,
    release: releaseAdmission('premium-checkout'),
  });
  const returnOrigin = new URL(app.auth().config.PUBLIC_APP_URL).origin;
  return createNativeBillingRuntime({
    vendor,
    returnOrigin,
    clock: app.clock,
    admit: createPurchaseAdmission({
      database: app.database,
      config,
      returnOrigin,
    }),
    purchaseStore,
    memberStore: app.database.billingMember({
      manage: canManageBilling,
      purchase: canPurchasePremium,
      allowance: allowance.decide,
    }),
    release: (key, accountId) =>
      isReleaseEnabled(
        key,
        accountId,
        createRequestFlagReader({
          read: app.database.readFlagSnapshot,
          now: () => Date.parse(app.clock.now()),
          diagnostic: () =>
            app.logger.log(
              'flags.read.failed',
              { operation: 'flags.read', cause: 'unavailable' },
              'Release control read failed',
            ),
        }),
      ),
  });
}
