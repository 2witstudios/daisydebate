import { supportMessageOperations } from '../support-messages';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Support messages and their owner mail, on the control lane (SUPP-1). */
export const createSupportStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...supportMessageOperations({ database: control, eventSink }),
  });
};
export type SupportStore = ReturnType<typeof createSupportStore>;
export type { SupportMessageNotice } from '../support-messages';
