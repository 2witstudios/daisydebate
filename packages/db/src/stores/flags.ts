import { flagOperations } from '../flags-operations';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Release flags and their account overrides, on the control lane. */
export const createFlagsStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...flagOperations({ database: control, eventSink }),
  });
};
export type FlagsStore = ReturnType<typeof createFlagsStore>;
