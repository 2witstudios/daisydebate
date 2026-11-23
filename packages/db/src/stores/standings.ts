import { standingsOperations } from '../standings';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** The ladder's standings, on the browse lane. */
export const createStandingsStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations(
    standingsOperations({ database: lane('browse').database, eventSink }),
  );
};
export type StandingsStore = ReturnType<typeof createStandingsStore>;
