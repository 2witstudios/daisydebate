import { agreementSignatureOperations } from '../agreement-signatures';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Agreement signatures, on the control lane. */
export const createAgreementsStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...agreementSignatureOperations({ database: control, eventSink }),
  });
};
export type AgreementsStore = ReturnType<typeof createAgreementsStore>;
