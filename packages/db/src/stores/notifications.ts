import { notificationOperations } from '../notifications';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Notifications and their digests, on the social lane. */
export const createNotificationsStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations(
    notificationOperations({ database: lane('social').database, eventSink }),
  );
};
export type NotificationsStore = ReturnType<typeof createNotificationsStore>;
export type { InboxRow } from '../notifications';
