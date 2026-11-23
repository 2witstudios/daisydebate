import { debaterFollowOperations } from '../debater-follows';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Debater follows, on the social lane. */
export const createDebaterFollowsStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations(
    debaterFollowOperations({ database: lane('social').database, eventSink }),
  );
};
export type DebaterFollowsStore = ReturnType<typeof createDebaterFollowsStore>;
