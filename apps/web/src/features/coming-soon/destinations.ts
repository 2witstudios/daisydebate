/** The eight product destinations, in landing order. */
export const destinationSlugs = [
  'ranked',
  'lobby',
  'watch',
  'judge',
  'tournaments',
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
 * Explainer copy for every destination. Daisy has one debate, called Ranked,
 * with one rating per player per season, so no format is named.
 */
export const destinations: Readonly<Record<DestinationSlug, Destination>> = {
  ranked: {
    slug: 'ranked',
    title: 'Ranked',
    tagline: 'Rated debates, one ladder per season.',
  },
  lobby: {
    slug: 'lobby',
    title: 'Lobby',
    tagline: 'Open tables and live rooms.',
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
  leaderboard: {
    slug: 'leaderboard',
    title: 'Leaderboard',
    tagline: 'The season ladder.',
  },
  train: {
    slug: 'train',
    title: 'Train',
    tagline: 'Drills, practice debates and review.',
  },
  prep: {
    slug: 'prep',
    title: 'Prep',
    tagline: 'Briefs, cases and evidence cards.',
  },
};

/** The destination for an untrusted route segment, or null when unknown. */
export const findDestination = (slug: string): Destination | null =>
  (destinationSlugs as readonly string[]).includes(slug)
    ? destinations[slug as DestinationSlug]
    : null;
