import { leaderboardDestinations } from '../leaderboard/actions';

/** The eight product destinations, in landing order. */
export const destinationSlugs = [
  'lobby',
  'watch',
  'judge',
  'tournaments',
  'seasons',
  'leaderboard',
  'train',
  'prep',
] as const;

export type DestinationSlug = (typeof destinationSlugs)[number];

/** What Home says about one destination. */
export type Destination = {
  readonly slug: DestinationSlug;
  readonly title: string;
  /** One line, shown on the landing tile. */
  readonly tagline: string;
};

/** Copy for every destination. Ranked play shares the normal Room lifecycle. */
export const destinations: Readonly<Record<DestinationSlug, Destination>> = {
  // The slug names the route it opens; the tile and rail call it Play.
  lobby: {
    slug: 'lobby',
    title: 'Play',
    tagline: 'Ranked and casual rooms.',
  },
  watch: {
    slug: 'watch',
    title: 'Watch',
    tagline: 'Live debates and recordings.',
  },
  judge: {
    slug: 'judge',
    title: 'Judge',
    tagline: 'Judge assigned debates.',
  },
  tournaments: {
    slug: 'tournaments',
    title: 'Tournaments',
    tagline: 'Weekly round robins to season championships.',
  },
  seasons: {
    slug: 'seasons',
    title: 'Seasons',
    tagline: 'Resolutions and standings.',
  },
  leaderboard: {
    slug: 'leaderboard',
    title: 'Leaderboard',
    tagline: 'The season ladder.',
  },
  train: {
    slug: 'train',
    title: 'Train',
    tagline: 'Practice debates against a bot opponent.',
  },
  prep: {
    slug: 'prep',
    title: 'Prep',
    tagline: 'Your documents, in one place, at Prep and in every Round.',
  },
};

/** Where a destination lives; Seasons lives under the Leaderboard. */
export const destinationHref = (slug: DestinationSlug): string =>
  slug === 'seasons' ? leaderboardDestinations.seasons : `/${slug}`;

/**
 * Whether a link may prefetch. Prep's page ships with #650, and a prefetch of a
 * route with no page never finishes, which would leave a request open on every
 * page with the rail. A click still gets the 404 (owner decision, ISSUE-1328).
 */
export const destinationPrefetch = (href: string): false | null =>
  href === destinationHref('prep') ? false : null;
