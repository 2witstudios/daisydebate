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
  ballots: (slug: string) => `${hostTournament(slug)}/ballots`,
  upgrade: (slug: string) => `${hostTournament(slug)}/upgrade`,
  billing: (slug: string) => `${hostTournament(slug)}/billing`,
} as const;
