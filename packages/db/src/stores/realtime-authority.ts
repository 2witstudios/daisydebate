import { createRoundFloorChannelCohortAuthority } from '../messaging/round-floor-observation';
import { youthLiveReadOperations } from '../youth-live-reads';
import { createRoomCommunityChannelCohortAuthority } from '../messaging/room-community-observation';
import { authorizationSessionOperations } from '../authorization-session';
import {
  createMessagingChannelAuthority,
  createMessagingChannelCohortAuthority,
} from '../messaging/authority-frame';
import { roomAuthorizationRead } from '../room-authorization-read';
import type { TxSource } from '../tx';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/**
 * The shared-fence authority reads a socket subscription needs, on one
 * lane: subscribes (`admission`) and renewals (`renewal`) are composed
 * separately, so an admission wave cannot consume renewal capacity.
 */
const authorityReads = (database: TxSource) => {
  const youthLive = youthLiveReadOperations({ database });
  return {
    roundFloorChannelCohortAuthority:
      createRoundFloorChannelCohortAuthority(database),
    /**
     * A live Youth Round's linked adults (ADR 0155, ADR 0158): whether it is
     * one, then its people, through the registered SECURITY DEFINER function
     * the web reads too; the realtime role holds no privilege on its tables.
     */
    readRoundYouth: youthLive.readRoundYouth,
    readYouthRoundPeople: youthLive.readYouthRoundPeople,
    roomCommunityChannelCohortAuthority:
      createRoomCommunityChannelCohortAuthority(database),
    ...authorizationSessionOperations({ database }),
    ...roomAuthorizationRead({ database }),
    messagingChannelAuthority: createMessagingChannelAuthority(database),
    messagingChannelCohortAuthority:
      createMessagingChannelCohortAuthority(database),
  };
};
export type RealtimeAuthorityReads = ReturnType<typeof authorityReads>;

/**
 * The authority reads on one realtime lane, under that lane's name:
 * `admission` for subscribes, `renewal` for renewals.
 */
export const createRealtimeAuthorityStore = <
  const Lane extends 'admission' | 'renewal',
>(
  resources: DatabaseResources,
  lane: Lane,
) =>
  namedLaneOperations({
    [lane]: authorityReads(resourcesOf(resources).lane(lane).database),
  } as { readonly [Name in Lane]: RealtimeAuthorityReads });
