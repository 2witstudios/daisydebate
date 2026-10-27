import type { DestinationSlug } from './destinations';

type LaunchConfig = Readonly<Record<DestinationSlug, boolean>>;

/**
 * Which destinations are open. Flip one to `true` when its real screens ship:
 * the nav then lists it, every link into it reaches the live route, and its
 * explainer redirects there. Until then the nav leaves it out and every link
 * into it goes to its explainer, never to sample data.
 */
export const launched: LaunchConfig = {
  ranked: false,
  lobby: true,
  watch: false,
  judge: true,
  tournaments: false,
  leaderboard: false,
  train: false,
  prep: false,
};

/** A member's own places that wait on a real backend, like the destinations. */
export type PlaceLaunchConfig = Readonly<Record<'notifications', boolean>>;

/**
 * Which of a member's own places are open. Notifications read sample data
 * until stored notifications ship (ISSUE-634); flip it then, and the rail
 * and the phone's More sheet list it again.
 */
export const launchedPlaces: PlaceLaunchConfig = { notifications: false };

/** The live route of a destination. */
export const liveHref = (slug: DestinationSlug): string => `/${slug}`;

/** The public explainer route of a destination. */
export const explainerHref = (slug: DestinationSlug): string =>
  `/coming-soon/${slug}`;

/**
 * Where a link into a destination points: the page asked for (its landing by
 * default) once the destination is launched, its explainer until then.
 */
export const destinationHref = (
  slug: DestinationSlug,
  {
    path = liveHref(slug),
    config = launched,
  }: { readonly path?: string; readonly config?: LaunchConfig } = {},
): string => (config[slug] ? path : explainerHref(slug));
