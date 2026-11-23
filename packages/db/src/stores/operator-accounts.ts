import { operatorAccountOperations } from '../operator-accounts';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Operator account commands, on the control lane. */
export const createOperatorAccountsStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...operatorAccountOperations({ database: control, eventSink }),
  });
};
export type OperatorAccountsStore = ReturnType<
  typeof createOperatorAccountsStore
>;
