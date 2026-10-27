import type { DestinationSlug } from '../../../../features/coming-soon/destinations';
import {
  launched,
  launchedPlaces,
  type PlaceLaunchConfig,
} from '../../../../features/coming-soon/launch';
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
  /** The launch flag that lists it; the nav leaves it out until it is set. */
  readonly launch?: DestinationSlug;
};

const allDestinations: readonly Destination[] = [
  { href: '/', icon: 'home', label: 'Home' },
  {
    href: '/lobby',
    icon: 'swords',
    label: 'Play',
    alsoActive: ['/play', '/ranked'],
    launch: 'lobby',
  },
  {
    href: '/tournaments',
    icon: 'trophy',
    label: 'Tournaments',
    launch: 'tournaments',
  },
  {
    href: '/leaderboard',
    icon: 'chart',
    label: 'Leaderboard',
    launch: 'leaderboard',
  },
  {
    href: '/watch',
    icon: 'eye',
    label: 'Watch',
    subItems: [
      { href: '/watch', label: 'Spectate live' },
      { href: '/recordings', label: 'Recordings' },
    ],
    launch: 'watch',
  },
  { href: '/judge', icon: 'gavel', label: 'Judge', launch: 'judge' },
  { href: '/train', icon: 'bolt', label: 'Train', launch: 'train' },
  { href: '/prep', icon: 'book', label: 'Prep', launch: 'prep' },
];

/**
 * The launched primary destinations, in rail order. One that is not
 * launched is left out rather than linked to sample data; Home's tiles
 * still point at its explainer.
 */
export const primaryDestinations: readonly Destination[] =
  allDestinations.filter(
    ({ launch }) => launch === undefined || launched[launch],
  );

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

/** A member's own places: their inbox and friends. */
export const memberDestinations = {
  messages: { href: '/messages', icon: 'message', label: 'Messages' },
  friends: { href: '/friends', icon: 'users', label: 'Friends' },
} as const satisfies Readonly<Record<string, Destination>>;

const notifications = {
  href: '/notifications',
  icon: 'bell',
  label: 'Notifications',
} as const satisfies Destination;

/**
 * Notifications, once its launch flag is set; until then the nav leaves it
 * out rather than linking a page of sample data.
 */
export const notificationsDestination = (
  config: PlaceLaunchConfig = launchedPlaces,
): typeof notifications | null => (config.notifications ? notifications : null);

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
