import { leaderboardDestinations } from '../leaderboard/actions';
import type { DestinationSlug } from './destinations';

export type LaunchConfig = Readonly<Record<DestinationSlug, boolean>>;

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
  watch: false,
  judge: true,
  tournaments: false,
  seasons: true,
  leaderboard: true,
  train: true,
  prep: true,
};

/** A member's own places that wait on a real backend, like the destinations. */
export type PlaceLaunchConfig = Readonly<Record<'notifications', boolean>>;

/** Which of a member's own places are open (WATCH-12, ISSUE-634). */
export const launchedPlaces: PlaceLaunchConfig = { notifications: true };

/** The first path segment each destination owns. Recordings and the audience belong to Watch. */
const destinationAreas: ReadonlyMap<string, DestinationSlug> = new Map([
  ['lobby', 'lobby'],
  ['watch', 'watch'],
  ['recordings', 'watch'],
  ['audience', 'watch'],
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

/** Watch's routes under a Round, beside the debaters' own. */
const watchRoundApis: ReadonlySet<string> = new Set([
  'audience',
  'timeline',
  'chat',
  'reactions',
  'viewers',
]);
const watchApis: ReadonlySet<string> = new Set([
  'recordings',
  'watch-history',
  'debater-follows',
]);

const destinationOfPath = (
  segments: readonly string[],
): DestinationSlug | undefined => {
  const [first = '', second = '', , fourth = ''] = segments;
  if (first === 'api') {
    // Capture can run while Watch is closed, so a participant's right to have a
    // Recording removed never waits on the flag; sign-in and its own rules decide.
    if (second === 'recordings' && fourth === 'removal') return undefined;
    if (watchApis.has(second)) return 'watch';
    return second === 'rounds' && watchRoundApis.has(fourth)
      ? 'watch'
      : undefined;
  }
  if (first === 'rounds' && segments[2] === 'audience-link') return 'watch';
  return destinationAreas.get(first);
};

/** Whether a path is an API route: a closed one answers as absent, not with a page. */
export const isApiPath = (pathname: string): boolean =>
  decodedSegment(pathname.split('/').find((part) => part !== '') ?? '') ===
  'api';

/**
 * The closed destination a path falls under, or null. The proxy answers such a
 * request with the explainer, before any page renders, and an API call with a
 * 404. Empty segments are dropped, so a doubled slash cannot step out of an
 * area, and each segment is read decoded, as the router matches it, so `/%70rep`
 * is still Prep.
 */
export const closedDestinationOf = (
  pathname: string,
  config: LaunchConfig = launched,
): DestinationSlug | null => {
  const slug = destinationOfPath(
    pathname
      .split('/')
      .filter((part) => part !== '')
      .map(decodedSegment),
  );
  return slug !== undefined && !config[slug] ? slug : null;
};

/**
 * A Room link, which a visitor may follow to Watch once the Round's start is
 * released: its page decides, so the proxy sends no sign-in hint ahead of it.
 * While Watch is closed it is an ordinary guarded page.
 */
export const roomLinkReachesWatch = (
  pathname: string,
  config: LaunchConfig = launched,
): boolean => config.watch && /^\/rooms\/[^/]+$/.test(pathname);

/** Where a Room's link sends someone outside it; null until Watch is open and the start released. */
export const roomWatchHref = (
  roundId: string | null,
  config: LaunchConfig = launched,
): string | null =>
  roundId !== null && config.watch
    ? `/watch/${encodeURIComponent(roundId)}`
    : null;

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
