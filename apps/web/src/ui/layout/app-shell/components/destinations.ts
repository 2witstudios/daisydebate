import type { IconName } from '../../../components/icon/icon';
import type { ShellAccount } from '../account';

type Destination = {
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
  readonly subItems?: readonly {
    readonly href: string;
    readonly label: string;
  }[];
  /** Routes that light this destination without a link of their own. */
  readonly alsoActive?: readonly string[];
};

/** The eight primary destinations, in rail order. */
export const primaryDestinations: readonly Destination[] = [
  { href: '/', icon: 'home', label: 'Home' },
  {
    href: '/lobby',
    icon: 'swords',
    label: 'Play',
    alsoActive: ['/play', '/ranked'],
  },
  { href: '/tournaments', icon: 'trophy', label: 'Tournaments' },
  { href: '/leaderboard', icon: 'chart', label: 'Leaderboard' },
  {
    href: '/watch',
    icon: 'eye',
    label: 'Watch',
    subItems: [
      { href: '/watch', label: 'Spectate live' },
      { href: '/recordings', label: 'Recordings' },
    ],
  },
  { href: '/judge', icon: 'gavel', label: 'Judge' },
  { href: '/train', icon: 'bolt', label: 'Train' },
  { href: '/prep', icon: 'book', label: 'Prep' },
];

/** More: settings and the legal and help pages. */
export const moreDestination: Destination = {
  href: '/settings',
  icon: 'dots',
  label: 'More',
  subItems: [
    { href: '/settings', label: 'Settings' },
    { href: '/help', label: 'Help' },
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
  ],
};

/** A member's own places: their inbox, notifications and friends. */
export const memberDestinations = {
  messages: { href: '/messages', icon: 'message', label: 'Messages' },
  notifications: {
    href: '/notifications',
    icon: 'bell',
    label: 'Notifications',
  },
  friends: { href: '/friends', icon: 'users', label: 'Friends' },
} as const satisfies Readonly<Record<string, Destination>>;

/** The accessible name of the Friends link, with the count in it. */
export const friendsLabel = (online: number): string =>
  `Friends, ${online} online`;

/** Where a member's profile lives. */
export const profileHref = (username: string): string => `/profile/${username}`;

/** The way in for anyone who is not yet a member. */
export const wayIn = (
  account: Exclude<ShellAccount, { readonly state: 'member' }>,
): { readonly href: string; readonly label: string } =>
  account.state === 'anonymous'
    ? { href: '/sign-in', label: 'Sign in' }
    : { href: '/onboarding/username', label: 'Finish sign-up' };
