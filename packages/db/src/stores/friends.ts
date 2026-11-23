import type { ContactAuthorizationFence } from '../contacts/fence';
import type { ContactReactions } from '../contacts/reactions';
import { friendshipReadOperations } from '../friends/reads';
import { createFriendStore } from '../friends/store';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Friends: the friendship reads and commands, on the social lane. */
export const createFriendsStore = (
  resources: DatabaseResources,
  { reactions }: { readonly reactions: ContactReactions },
) => {
  const { lane, eventSink } = resourcesOf(resources);
  const social = lane('social').database;
  return namedLaneOperations({
    ...friendshipReadOperations({ database: social, eventSink }),
    friendStore: (authorize: ContactAuthorizationFence) =>
      createFriendStore({ database: social, authorize, reactions }),
  });
};
export type FriendsStore = ReturnType<typeof createFriendsStore>;
