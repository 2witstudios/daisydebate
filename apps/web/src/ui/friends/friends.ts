import type {
  FriendList,
  FriendPresence,
  PresenceStatus,
} from '@daisy/protocol';

/** Your own status on the rail: a member looking at a page is online. */
export const viewerStatus: PresenceStatus = 'online';

export const presenceLabel: Readonly<Record<FriendPresence, string>> = {
  online: 'Online',
  away: 'Away',
  offline: 'Offline',
};

/** How many friends are around: online or away, not offline. */
export const friendsAround = (friends: FriendList['friends']): number =>
  friends.filter((friend) => friend.presence !== 'offline').length;

/** The Friends page's lede: who is around, or how to start. */
export function friendsLede(list: Pick<FriendList, 'friends'>): string {
  if (list.friends.length === 0)
    return 'Add a friend by username to see when they are online.';
  const around = friendsAround(list.friends);
  return `${around} of ${list.friends.length} online`;
}
