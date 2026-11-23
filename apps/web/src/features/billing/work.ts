import { featureWork, type ProcessWork } from '../../server/feature-work';
import { startBillingCleanup } from '../../server/billing-cleanup';
import { startBillingEconomics } from '../../server/billing-economics';
import { startBillingPurchases } from '../../server/billing-purchases';
import { startBillingRefunds } from '../../server/billing-refunds';
import { startBillingSubscriptions } from '../../server/billing-subscriptions';
import { startUsageRecovery } from '../../server/usage-recovery';

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
