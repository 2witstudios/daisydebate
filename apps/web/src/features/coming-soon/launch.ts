import type { DestinationSlug } from './destinations';

/**
 * Which destinations are open. Flip one to `true` when its real screens ship:
 * its landing tile then links to the live route and its explainer redirects
 * there. Nothing is launched yet.
 */
export const launched: Readonly<Record<DestinationSlug, boolean>> = {
  ranked: false,
  lobby: false,
  watch: false,
  judge: false,
  tournaments: false,
  leaderboard: false,
  train: false,
  prep: false,
};

/** The live route of a destination. */
export const liveHref = (slug: DestinationSlug): string => `/${slug}`;

/** The public explainer route of a destination. */
export const explainerHref = (slug: DestinationSlug): string =>
  `/coming-soon/${slug}`;

/** Where a destination's landing tile points, given the launch config. */
export const tileHref = (
  slug: DestinationSlug,
  config: Readonly<Record<DestinationSlug, boolean>> = launched,
): string => (config[slug] ? liveHref(slug) : explainerHref(slug));
