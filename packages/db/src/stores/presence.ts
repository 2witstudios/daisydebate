import { peopleListOperations } from '../presence/people-list';
import { presenceSettingOperations } from '../presence/settings';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Presence settings and the People list, on the social lane. */
export const createPresenceStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const social = lane('social').database;
  return namedLaneOperations({
    ...presenceSettingOperations({ database: social, eventSink }),
    ...peopleListOperations({ database: social, eventSink }),
  });
};
export type PresenceStore = ReturnType<typeof createPresenceStore>;
