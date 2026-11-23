import { watchHistoryOperations } from '../watch-history';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Watch history, on the social lane. */
export const createWatchHistoryStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations(
    watchHistoryOperations({ database: lane('social').database, eventSink }),
  );
};
export type WatchHistoryStore = ReturnType<typeof createWatchHistoryStore>;
