import { databaseHealthOperations } from '../database-health';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** The database's health: reachability, schema and tenant fence checks, on the control lane. */
export const createHealthStore = (resources: DatabaseResources) => {
  const { lane, dedicated, eventSink } = resourcesOf(resources);
  return namedLaneOperations(
    databaseHealthOperations({
      database: lane('control').database,
      dedicated,
      eventSink,
    }),
  );
};
