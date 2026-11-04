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

/** What the public explainer says about one destination that is not open yet. */
export type Destination = {
  readonly slug: DestinationSlug;
  readonly title: string;
  /** One line, shown on the landing tile and under the explainer title. */
  readonly tagline: string;
};

/**
 * Explainer copy for every destination. Ranked play shares the normal Room lifecycle.
 */
export const destinations: Readonly<Record<DestinationSlug, Destination>> = {
  // The slug names the route it opens; the tile, rail and preview call it Play.
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
    tagline: 'Bracket and round-robin events.',
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

/** The destination for an untrusted route segment, or null when unknown. */
export const findDestination = (slug: string): Destination | null =>
  (destinationSlugs as readonly string[]).includes(slug)
    ? destinations[slug as DestinationSlug]
    : null;
