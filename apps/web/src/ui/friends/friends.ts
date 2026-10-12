import type { PresenceStatus } from '@daisy/protocol';

type OnlineUser = {
  readonly name: string;
  readonly presence: PresenceStatus;
};

export type FriendStatus = Exclude<PresenceStatus, 'offline'>;

type FriendAction = { readonly label: string; readonly href: string };

type Friend = {
  readonly name: string;
  readonly status: FriendStatus;
  readonly profileHref: string;
  /** What you can do with them right now, if anything. */
  readonly action: FriendAction | null;
};

export type FriendGroup = {
  readonly status: FriendStatus;
  readonly label: string;
  readonly people: readonly Friend[];
};

/** Your own status, as the pill reads it. Sample until presence is real. */
export const viewerStatus: FriendStatus = 'online';

const statusLabel: Readonly<Record<FriendStatus, string>> = {
  online: 'Online',
  'in-debate': 'In a debate',
  away: 'Away',
};

const groupOrder: readonly FriendStatus[] = ['in-debate', 'online', 'away'];

const handleOf = (name: string): string =>
  name.toLowerCase().trim().replace(/\s+/g, '-');

const actionFor = (status: FriendStatus): FriendAction | null =>
  status === 'in-debate'
    ? { label: 'Watch', href: '/watch' }
    : status === 'online'
      ? { label: 'Challenge', href: '/play/room' }
      : null;

/** How many are around right now: online or in a debate, not away. */
export const onlineNow = (users: readonly OnlineUser[]): number =>
  users.filter(
    (user) => user.presence !== 'away' && user.presence !== 'offline',
  ).length;

/**
 * The Friends list: people who are around, grouped by what they are doing
 * (debating first, then online, then away). Offline people are not shown.
 */
export function friendGroups(
  users: readonly OnlineUser[],
): readonly FriendGroup[] {
  return groupOrder
    .map((status) => ({
      status,
      label: statusLabel[status],
      people: users
        .filter((user) => user.presence === status)
        .map((user) => ({
          name: user.name,
          status,
          profileHref: `/profile/${handleOf(user.name)}`,
          action: actionFor(status),
        })),
    }))
    .filter((group) => group.people.length > 0);
}
