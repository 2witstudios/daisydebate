import type { PresenceStatus } from '@daisy/protocol';

type OnlineUser = {
  readonly name: string;
  readonly presence: PresenceStatus;
};

export type DockStatus = Exclude<PresenceStatus, 'offline'>;

type DockAction = { readonly label: string; readonly href: string };

type DockPerson = {
  readonly name: string;
  readonly status: DockStatus;
  readonly profileHref: string;
  /** What you can do with them right now, if anything. */
  readonly action: DockAction | null;
};

export type DockGroup = {
  readonly status: DockStatus;
  readonly label: string;
  readonly people: readonly DockPerson[];
};

/** Your own status, as the pill reads it. Sample until presence is real. */
export const viewerStatus: DockStatus = 'online';

export const statusLabel: Readonly<Record<DockStatus, string>> = {
  online: 'Online',
  'in-debate': 'In a debate',
  away: 'Away',
};

const groupOrder: readonly DockStatus[] = ['in-debate', 'online', 'away'];

const handleOf = (name: string): string =>
  name.toLowerCase().trim().replace(/\s+/g, '-');

const actionFor = (status: DockStatus): DockAction | null =>
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
 * The dock's list: people who are around, grouped by what they are doing
 * (debating first, then online, then away). Offline people are not shown.
 */
export function dockGroups(users: readonly OnlineUser[]): readonly DockGroup[] {
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
