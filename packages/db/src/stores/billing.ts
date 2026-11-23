import { billingOperations } from '../billing-operations';
import { usageRecoveryOperations } from '../usage-recovery';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Billing and usage recovery, through the control lane's bounded transaction. */
export const createBillingStore = (
  resources: DatabaseResources,
  { nextId }: { readonly nextId: () => string },
) => {
  const run = resourcesOf(resources).bounded('control');
  return namedLaneOperations({
    ...usageRecoveryOperations(run),
    ...billingOperations({ run, nextId }),
  });
};
export type BillingStore = ReturnType<typeof createBillingStore>;
