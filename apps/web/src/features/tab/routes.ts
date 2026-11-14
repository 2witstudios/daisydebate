/**
 * Every Tab address. The host area is the participant side's paths under
 * `/host`, plus the pages only a host has.
 */
const tournament = (slug: string) => `/tournaments/${slug}`;
const league = (slug: string) => `/leagues/${slug}`;
const room = (id: string) => `/rooms/sample/${id}`;
const withEvent = (path: string, event: string | null) =>
  event === null ? path : `${path}?event=${event}`;

export type LeagueTab = 'rooms' | 'ladder' | 'season' | 'tournaments';

export const tabRoutes = {
  tournaments: '/tournaments',
  walk: '/tournaments/walk',
  tournament,
  round: (slug: string, event: string, round: string) =>
    `${tournament(slug)}/events/${event}/rounds/${round}`,
  standings: (slug: string, event: string | null = null) =>
    withEvent(`${tournament(slug)}/standings`, event),
  bracket: (slug: string, event: string | null = null) =>
    withEvent(`${tournament(slug)}/bracket`, event),
  entries: (slug: string) => `${tournament(slug)}/entries`,
  league: (slug: string, tab: LeagueTab = 'rooms') =>
    tab === 'rooms' ? league(slug) : `${league(slug)}?tab=${tab}`,
  newLeagueRoom: (slug: string) => `${league(slug)}/rooms/new`,
  room,
  liveRoom: (id: string) => `${room(id)}/live`,
  ballot: (id: string) => `${room(id)}/ballot`,
  minor: (id: string) => `/family/${id}`,
  allowTournament: (minor: string, slug: string) =>
    `/family/${minor}/allow/${slug}`,
} as const;

const hostTournament = (slug: string) => `/host${tournament(slug)}`;
const hostEvent = (slug: string, event: string) =>
  `${hostTournament(slug)}/events/${event}`;

export const hostRoutes = {
  home: '/host',
  league: (slug: string) => `/host${league(slug)}`,
  leaguePeople: (slug: string) => `/host${league(slug)}/people`,
  tournament: hostTournament,
  setup: (slug: string, panel: 'pairing' | null = null) =>
    panel === null
      ? `${hostTournament(slug)}/setup`
      : `${hostTournament(slug)}/setup?panel=${panel}`,
  events: (slug: string, event: string | null = null) =>
    withEvent(`${hostTournament(slug)}/events`, event),
  entries: (slug: string) => `${hostTournament(slug)}/entries`,
  judges: (slug: string) => `${hostTournament(slug)}/judges`,
  people: (slug: string) => `${hostTournament(slug)}/people`,
  slot: (slug: string, slot: string, event: string | null = null) =>
    withEvent(`${hostTournament(slug)}/slots/${slot}`, event),
  round: (
    slug: string,
    event: string,
    round: string,
    fixture: string | null = null,
  ) =>
    fixture === null
      ? `${hostEvent(slug, event)}/rounds/${round}`
      : `${hostEvent(slug, event)}/rounds/${round}?fixture=${fixture}`,
  ballot: (slug: string, event: string) => `${hostEvent(slug, event)}/ballot`,
  resolutions: (slug: string, event: string) =>
    `${hostEvent(slug, event)}/resolutions`,
  standings: (slug: string) => `${hostTournament(slug)}/standings`,
  results: (slug: string) => `${hostTournament(slug)}/results`,
} as const;

/** The pages only the host area has, as the last segment of their path. */
const hostOnly = new Set([
  'setup',
  'entries',
  'judges',
  'people',
  'results',
  'ballot',
  'resolutions',
]);

/**
 * Where someone without a grant lands when they open a host address: the same
 * path without the prefix, or the nearest participant page above a host-only
 * one.
 */
export function participantPathOf(hostPath: string): string {
  const segments = hostPath.split('/').filter(Boolean).slice(1);
  const [area, slug] = segments;
  if (area === 'leagues' && slug !== undefined) return league(slug);
  if (area !== 'tournaments' || slug === undefined)
    return tabRoutes.tournaments;
  const rest = segments.slice(2);
  const last = rest.at(-1);
  if (
    rest.length === 0 ||
    (last !== undefined && hostOnly.has(last)) ||
    rest[0] === 'slots' ||
    (rest[0] === 'events' && rest.length === 1)
  )
    return tournament(slug);
  return `/${segments.join('/')}`;
}

const tabPrefixes = [
  '/host',
  '/tournaments/',
  '/leagues/',
  '/rooms/sample/',
  '/family/',
];

/**
 * Whether a path a form sent back is one of Tab's own pages. It round-trips
 * through the browser, so it is untrusted: a bare local path only, with no
 * query, fragment, scheme or parent step.
 */
export const isTabPath = (path: string): boolean =>
  /^\/[a-z0-9/-]*$/.test(path) &&
  !path.includes('//') &&
  tabPrefixes.some(
    (prefix) => path === prefix || path.startsWith(prefix.replace(/\/?$/, '/')),
  );
