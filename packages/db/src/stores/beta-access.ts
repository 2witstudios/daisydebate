import { betaAccessOperations } from '../beta-access';
import { preapprovalOperations } from '../beta-preapprovals';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Beta access and operator preapprovals, on the control lane. */
export const createBetaAccessStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...betaAccessOperations({ database: control, eventSink }),
    ...preapprovalOperations({ database: control }),
  });
};
export type BetaAccessStore = ReturnType<typeof createBetaAccessStore>;
