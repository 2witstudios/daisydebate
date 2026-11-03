import { leaderboardDestinations } from '../leaderboard/actions';
import type { DestinationSlug } from './destinations';

type LaunchConfig = Readonly<Record<DestinationSlug, boolean>>;

/**
 * Which destinations are open. Flip one to `true` when its real screens ship:
 * the nav then lists it, every link into it reaches the live route, and its
 * explainer redirects there. Until then the nav leaves it out, and every link
 * into it and every typed address under it reaches its explainer, never sample
 * data (`closedDestinationOf`). Seasons is the exception: a tile for a public
 * page under the Leaderboard, so its flag changes only the tile and the
 * explainer redirect.
 */
export const launched: LaunchConfig = {
  lobby: true,
  watch: true,
  judge: true,
  tournaments: false,
  seasons: true,
  leaderboard: true,
  train: true,
  prep: false,
};

/** A member's own places that wait on a real backend, like the destinations. */
export type PlaceLaunchConfig = Readonly<Record<'notifications', boolean>>;

/**
 * Which of a member's own places are open. Nothing stores a notification
 * until WATCH-12 (ISSUE-634); flip it then, and the rail and the phone's More
 * sheet list it again.
 */
export const launchedPlaces: PlaceLaunchConfig = { notifications: false };

/** The first path segment each destination owns. Recordings belong to Watch. */
const destinationAreas: ReadonlyMap<string, DestinationSlug> = new Map([
  ['lobby', 'lobby'],
  ['watch', 'watch'],
  ['recordings', 'watch'],
  ['judge', 'judge'],
  ['tournaments', 'tournaments'],
  ['leaderboard', 'leaderboard'],
  ['train', 'train'],
  ['prep', 'prep'],
]);

const decodedSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * The closed destination a path falls under, or null. The proxy answers such a
 * request with the explainer, before any page renders. Empty segments are
 * dropped, so a doubled slash cannot step out of an area, and the segment is
 * read decoded, as the router matches it, so `/%70rep` is still Prep.
 */
export const closedDestinationOf = (
  pathname: string,
  config: LaunchConfig = launched,
): DestinationSlug | null => {
  const [first = ''] = pathname.split('/').filter((part) => part !== '');
  const slug = destinationAreas.get(decodedSegment(first));
  return slug !== undefined && !config[slug] ? slug : null;
};

/** The live route of a destination; Seasons lives under the Leaderboard. */
export const liveHref = (slug: DestinationSlug): string =>
  slug === 'seasons' ? leaderboardDestinations.seasons : `/${slug}`;

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
