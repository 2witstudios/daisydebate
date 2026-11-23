import { memberDivisionOperations } from '../member-division';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** A member's division, on the control lane. */
export const createMemberDivisionStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...memberDivisionOperations({ database: control, eventSink }),
  });
};
