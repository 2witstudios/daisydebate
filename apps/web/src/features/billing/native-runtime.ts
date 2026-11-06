import type { Clock } from '@daisy/clock';
import type { NativeBillingRuntime } from './native-contract';
import type { BillingConfig } from '@daisy/config';
import type { ReleaseFlagReader } from '../flags/catalogue';
import { createCheckoutVendor, type CheckoutPort } from './checkout-vendor';
import {
  discoverCheckout,
  type CheckoutSearchPort,
} from './checkout-discovery';
import { createPurchaseFlow } from './purchase-flow';
import { createPortalSession } from './portal-session';
import {
  billingSettingsView,
  type BillingSettingsSource,
} from './settings-view';

type Subject = { readonly userId: string; readonly actorId: string };
type FlowInput = Parameters<typeof createPurchaseFlow>[0];
type PortalInput = Parameters<typeof createPortalSession>[0];
export type NativeBillingVendor =
  | { readonly kind: 'disabled' }
  | {
      readonly kind: 'stripe';
      readonly config: Extract<BillingConfig, { kind: 'stripe' }>;
      readonly checkout: CheckoutPort & CheckoutSearchPort;
      readonly portal: PortalInput['create'];
    };

/** Native customer operations compose existing durable admission; transport never grants access. */
export function createNativeBillingRuntime(input: {
  readonly vendor: NativeBillingVendor;
  readonly returnOrigin: string;
  readonly clock: Clock;
  readonly memberStore: {
    readonly read: (subject: Subject) => Promise<BillingSettingsSource>;
    readonly portalCustomer: PortalInput['customer'];
  };
  readonly purchaseStore: FlowInput['store'];
  readonly admit: FlowInput['admit'];
  readonly release: ReleaseFlagReader;
}): NativeBillingRuntime {
  const vendor = input.vendor;
  const purchase =
    vendor.kind === 'stripe'
      ? createPurchaseFlow({
          admit: input.admit,
          store: input.purchaseStore,
          vendor: createCheckoutVendor({
            port: vendor.checkout,
            clock: input.clock,
            mode: vendor.config.mode,
          }),
          discover: (purchase) =>
            discoverCheckout(
              { port: vendor.checkout, mode: vendor.config.mode },
              purchase,
            ),
        })
      : null;
  const portal =
    vendor.kind === 'stripe'
      ? createPortalSession({
          mode: vendor.config.mode,
          configurationId: vendor.config.portalConfigurationId,
          returnOrigin: input.returnOrigin,
          customer: input.memberStore.portalCustomer,
          create: vendor.portal,
        })
      : null;
  return {
    checkout: (subject: Subject) =>
      purchase
        ? purchase(subject)
        : Promise.resolve({ kind: 'unavailable' } as const),
    portal: (subject: Subject) =>
      portal
        ? portal(subject)
        : Promise.resolve({ kind: 'unavailable' } as const),
    settings: async (subject: Subject) => {
      const source = await input.memberStore.read(subject);
      let purchaseVisible = false;
      try {
        purchaseVisible = await input.release(
          'premium-checkout',
          subject.userId,
        );
      } catch {
        /* Display fails closed; management and canonical admission are independent. */
      }
      return billingSettingsView({
        source,
        configured: vendor.kind === 'stripe',
        purchaseVisible,
      });
    },
  };
}
