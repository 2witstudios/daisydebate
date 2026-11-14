import type {
  LobbyLadder,
  LobbyListPage,
  LobbyRoomList,
  StandingLobbyView,
} from '@daisy/protocol/lobby/lobby-read';
import { linkTo, sampleAction } from '../action';
import type { LadderScope, LeaguePanel, SeasonRow } from '../league';
import { tabRoutes } from '../routes';
import { seasonRow, topOfSeason } from './league';
import { IMPROMPTU, LEAGUE, LEAGUE_NAME, VARSITY } from './moment';
import { own } from './own';
import { at, sampleId } from './posting';
import type { SampleScene } from './scene';
import { autumnAsOf } from './tournament-autumn';
import {
  listedAutumn,
  listedChampionship,
  listedOpener,
  listedRidgeview,
  listedWinter,
} from './tournament';

/** Everyone signed in is a member of the sample league; a visitor is not. */
export const isMember = (scene: SampleScene): boolean =>
  scene.viewer !== 'visitor';

const league = {
  kind: 'organization',
  organizationId: sampleId(LEAGUE),
  organizationKind: 'league',
  name: LEAGUE_NAME,
} as const;

/** The league's standing lobby, as one viewer reads it. */
export const sampleStandingLobby = (scene: SampleScene): StandingLobbyView => ({
  kind: 'standing',
  lobbyId: sampleId(`${LEAGUE}/lobby`),
  handle: LEAGUE,
  name: LEAGUE_NAME,
  owner: league,
  signedIn: scene.viewer !== 'visitor',
  viewerRoles: isMember(scene) ? ['member'] : [],
  asOf: autumnAsOf(scene),
  resolutionPool: {
    name: 'November',
    resolutions: 30,
    theme: 'cities and transport',
    perRoom: 5,
  },
  season: '2026 to 27',
  offeredTemplates: [
    { templateId: sampleId('varsity-template'), name: 'Varsity debate' },
  ],
  ladder: { rating: 1548, place: 31, of: 148 },
  capabilities: { createRoom: isMember(scene) },
});

/** The lobby's Rooms: asked of the lobby, never of a Room collection. */
export const sampleLobbyRooms = (scene: SampleScene): LobbyRoomList => {
  const asOf = autumnAsOf(scene);
  return {
    lobbyId: sampleId(`${LEAGUE}/lobby`),
    asOf,
    rooms: [
      {
        status: 'open',
        roomId: sampleId(`${LEAGUE}/castillo`),
        name: "Castillo's room",
        host: { username: 'Castillo', rating: 1655 },
        school: 'Ridgeview',
        open: { debaters: 1, judges: 1 },
        openedAt: asOf,
        capabilities: { join: true, judge: true },
      },
      {
        status: 'open',
        roomId: sampleId(`${LEAGUE}/practice`),
        name: 'Practice before Winter Classic',
        host: { username: 'Brooks', rating: null },
        school: 'Hartwell',
        open: { debaters: 0, judges: 1 },
        openedAt: new Date(Date.parse(asOf) - 4 * 60_000).toISOString(),
        capabilities: { join: false, judge: true },
      },
      {
        status: 'live',
        roomId: sampleId(`${LEAGUE}/jensen-wu`),
        debaters: ['Jensen', 'Wu'],
        judges: ['Okoye'],
        segment: 'Third speech',
        capabilities: { watch: true },
      },
      {
        status: 'live',
        roomId: sampleId(`${LEAGUE}/amari-petrov`),
        debaters: ['Amari', 'Petrov'],
        judges: ['Brooks'],
        segment: 'Preparing',
        capabilities: { watch: true },
      },
    ],
  };
};

const line = (
  place: number,
  username: string,
  school: string,
  wins: number,
  losses: number,
  rating: number,
  change: number,
) => ({
  actorId: sampleId(`ladder/${username}`),
  place,
  username,
  school,
  wins,
  losses,
  rating,
  change,
});

const you = line(31, 'doyle', 'Lakeside', 14, 9, 1548, 12);
const top = [
  line(1, 'Jensen', 'Hartwell', 22, 3, 1702, 8),
  line(2, 'Castillo', 'Ridgeview', 19, 5, 1655, 21),
  line(3, 'Amari', 'Lakeside', 17, 6, 1649, -4),
  line(4, 'Haddad', 'Ridgeview', 18, 8, 1640, 3),
  line(5, 'Wu', 'Hartwell', 15, 7, 1631, 0),
  line(6, 'Okafor', 'Okafor family', 12, 5, 1622, 15),
];
const around = [
  line(29, 'Petrov', 'Ridgeview', 13, 8, 1553, -6),
  line(30, 'Brooks', 'Hartwell', 12, 9, 1550, 4),
  you,
  line(32, 'Nakata', 'Lakeside', 11, 8, 1544, 9),
  line(33, 'Reid', 'Lakeside', 12, 10, 1541, -2),
];

/** One page of the lobby's ladder: the top, around the viewer, or a search. */
export function sampleLadder(scope: LadderScope, search: string): LobbyLadder {
  const base = { lobbyId: sampleId(`${LEAGUE}/lobby`), entrants: 148 };
  if (search !== '')
    return {
      ...base,
      page: 1,
      pages: 1,
      viewer: you,
      lines: [...top, ...around].filter((one) =>
        one.username.toLowerCase().includes(search.toLowerCase()),
      ),
    };
  return scope === 'top'
    ? { ...base, page: 1, pages: 25, viewer: you, lines: top }
    : { ...base, page: 1, pages: 1, viewer: you, lines: around };
}

/** The league's tournaments, in the order its calendar runs. */
export const sampleLeagueTournaments = (scene: SampleScene): LobbyListPage => ({
  asOf: autumnAsOf(scene),
  lobbies: [
    listedAutumn(scene),
    listedRidgeview,
    { ...listedWinter(scene), startsAt: at('2026-12-12', '09:00') },
    listedChampionship,
    listedOpener(scene),
  ],
  more: 0,
  capabilities: scene.viewer === 'visitor' ? null : { createLobby: true },
});

const debatePoints = [
  { label: 'Each prelim win', points: 2 },
  { label: 'Reaching the break', points: 3 },
  { label: 'Each elimination win', points: 3 },
];

/** Season standings by event: its rows, how many entries, how points count. */
const seasons: Readonly<
  Record<
    string,
    {
      readonly name: string;
      readonly rows: readonly SeasonRow[];
      readonly entries: number;
      readonly points: readonly {
        readonly label: string;
        readonly points: number;
      }[];
    }
  >
> = {
  [VARSITY]: {
    name: 'Varsity debate',
    rows: [
      seasonRow(9, 'You', 'Lakeside', 6, true),
      ...topOfSeason,
      seasonRow(4, 'Haddad', 'Ridgeview', 12),
    ],
    entries: 40,
    points: debatePoints,
  },
  'novice-debate': {
    name: 'Novice debate',
    rows: [
      seasonRow(1, 'Ellis', 'Hartwell', 14),
      seasonRow(2, 'Farrow', 'Lakeside', 11),
      seasonRow(3, 'Okoye', 'Ridgeview', 9),
      seasonRow(4, 'Sato', 'Lakeside', 8),
    ],
    entries: 26,
    points: debatePoints,
  },
  parli: {
    name: 'Parli',
    rows: [
      seasonRow(1, 'Hartwell A', 'Hartwell', 16),
      seasonRow(2, 'Ridgeview C', 'Ridgeview', 13),
      seasonRow(3, 'Lakeside A', 'Lakeside', 10),
      seasonRow(4, 'Ridgeview B', 'Ridgeview', 8),
    ],
    entries: 18,
    points: debatePoints,
  },
  [IMPROMPTU]: {
    name: 'Impromptu',
    rows: [
      seasonRow(1, 'Hana Kim', 'Ridgeview', 9),
      seasonRow(2, 'Sam Ortega', 'Hartwell', 7),
      seasonRow(3, 'Priya Nair', 'Lakeside', 6),
      seasonRow(4, 'Tomas Ruiz', 'Ridgeview', 5),
    ],
    entries: 35,
    points: [
      { label: 'Each section won', points: 2 },
      { label: 'Reaching the final', points: 3 },
    ],
  },
};

/**
 * The season tab, still drawn from the sample: the season read covers one
 * series and does not yet carry each event's points rules.
 */
export function sampleSeasonPanel(event: string | null): LeaguePanel | null {
  // An unknown event reads as the default one, as an unknown tab does.
  const slug = event !== null && own(seasons, event) !== null ? event : VARSITY;
  const chosen = own(seasons, slug);
  if (chosen === null) return null;
  return {
    kind: 'season',
    address: tabRoutes.league(LEAGUE),
    season: '2026 to 27',
    events: Object.entries(seasons).map(([id, { name }]) => ({
      slug: id,
      name,
    })),
    event: slug,
    rows: chosen.rows,
    all: sampleAction(`All ${chosen.entries} entries`),
    points: chosen.points,
    note: 'From 1 certified tournament, September Opener. Autumn Open is added when its results are certified. Only tournaments the league has sanctioned count; lobby rooms do not.',
    tournaments: linkTo('Tournaments', tabRoutes.league(LEAGUE, 'tournaments')),
  };
}
