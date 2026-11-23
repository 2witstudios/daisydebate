import { featureWork, type ProcessWork } from '../../server/feature-work';
import { startBillingCleanup } from './cleanup-worker';
import { startBillingEconomics } from './economics-worker';
import { startBillingPurchases } from './purchases-worker';
import { startBillingRefunds } from './refunds-worker';
import { startBillingSubscriptions } from './subscriptions-worker';
import { startUsageRecovery } from './usage-recovery-worker';

/** Billing's background work: allowance recovery, economics and Stripe reconciliation. */
export const startBillingWork = ({
  app,
  instanceId,
  waits,
  vendorFetch: fetch,
}: ProcessWork) =>
  featureWork({
    usageRecovery: startUsageRecovery({ app, instanceId, waits }),
    billingEconomics: startBillingEconomics({ app, instanceId, waits }),
    billingSubscriptions: startBillingSubscriptions({
      app,
      instanceId,
      waits,
      fetch,
    }),
    billingRefunds: startBillingRefunds({ app, instanceId, waits, fetch }),
    billingPurchases: startBillingPurchases({ app, instanceId, waits, fetch }),
    billingCleanup: startBillingCleanup({ app, instanceId, waits, fetch }),
  });
