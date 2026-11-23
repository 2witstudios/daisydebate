import { leagueRequestOperations } from '../league-requests';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** League requests and their owner mail, on the control lane. */
export const createLeagueRequestsStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...leagueRequestOperations({ database: control, eventSink }),
  });
};
export type LeagueRequestsStore = ReturnType<typeof createLeagueRequestsStore>;
export type { LeagueRequestNotice } from '../league-requests';
