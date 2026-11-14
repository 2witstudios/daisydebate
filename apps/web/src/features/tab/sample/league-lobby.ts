import { linkTo, sampleAction, type TabAction } from '../action';
import type {
  LadderRow,
  LadderScope,
  LeagueLobby,
  LeaguePanel,
  LeagueView,
  SeasonRow,
} from '../league';
import { tabRoutes, type LeagueTab } from '../routes';
import { seasonRow, topOfSeason } from './league';
import {
  AUTUMN,
  IMPROMPTU,
  LEAGUE,
  LEAGUE_NAME,
  VARSITY,
  WINTER,
} from './moment';
import { own } from './own';
import type { SampleScene } from './scene';
import { autumnStanding } from './tournament';

const tabs: readonly (readonly [LeagueTab, string])[] = [
  ['rooms', 'Rooms'],
  ['ladder', 'Ladder'],
  ['season', 'Season'],
  ['tournaments', 'Tournaments'],
];

const rooms: LeaguePanel = {
  kind: 'rooms',
  pool: {
    title: "November's pool:",
    detail:
      '30 resolutions on cities and transport. Every room strikes from five of them.',
  },
  groups: [
    {
      heading: 'Open',
      rooms: [
        {
          title: "Castillo's room",
          detail: 'Ridgeview · 1655 · needs an opponent and a judge',
          action: sampleAction('Join', true),
        },
        {
          title: 'Practice before Winter Classic',
          detail: 'Hartwell · needs a judge · waiting 4 min',
          action: sampleAction('Judge', true),
        },
      ],
    },
    {
      heading: 'Live now',
      rooms: [
        {
          title: 'Jensen v Wu',
          detail: 'Third speech · judged by Okoye',
          action: sampleAction('Watch'),
        },
        {
          title: 'Amari v Petrov',
          detail: 'Preparing · judged by Brooks',
          action: sampleAction('Watch'),
        },
      ],
    },
  ],
  note: "Rooms here use the league's format and count for the league ladder. Only members can see them.",
};

const rated = (
  place: number,
  name: string,
  school: string,
  record: string,
  rating: number,
  change: number,
): LadderRow => ({
  place,
  name,
  school,
  record,
  rating,
  change,
  you: name === 'You',
  profile: sampleAction(name),
});

const you = rated(31, 'You', 'Lakeside', '14–9', 1548, 12);
const top: readonly LadderRow[] = [
  rated(1, 'Jensen', 'Hartwell', '22–3', 1702, 8),
  rated(2, 'Castillo', 'Ridgeview', '19–5', 1655, 21),
  rated(3, 'Amari', 'Lakeside', '17–6', 1649, -4),
  rated(4, 'Haddad', 'Ridgeview', '18–8', 1640, 3),
  rated(5, 'Wu', 'Hartwell', '15–7', 1631, 0),
  rated(6, 'Okafor', 'Okafor family', '12–5', 1622, 15),
];
const around: readonly LadderRow[] = [
  rated(29, 'Petrov', 'Ridgeview', '13–8', 1553, -6),
  rated(30, 'Brooks', 'Hartwell', '12–9', 1550, 4),
  you,
  rated(32, 'Nakata', 'Lakeside', '11–8', 1544, 9),
  rated(33, 'Reid', 'Lakeside', '12–10', 1541, -2),
];

function ladder(scope: LadderScope, search: string): LeaguePanel {
  const found = [...top, ...around].filter((row) =>
    row.name.toLowerCase().includes(search.toLowerCase()),
  );
  return {
    kind: 'ladder',
    address: tabRoutes.league(LEAGUE),
    scope,
    search,
    // Your own line leads the top of the ladder, wherever you stand on it.
    rows: search !== '' ? found : scope === 'top' ? [you, ...top] : around,
    count:
      search !== ''
        ? `${found.length} of 148 debaters`
        : scope === 'top'
          ? '148 debaters · Page 1 of 25'
          : '148 debaters',
    next: search === '' && scope === 'top' ? sampleAction('Next') : null,
    note: "Rates this lobby's rooms and the league's tournaments. Separate from Daisy's ladders.",
    rules: sampleAction('How ratings work'),
  };
}

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

function seasonPanel(event: string | null): LeaguePanel | null {
  const slug = event ?? VARSITY;
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

function tournamentsPanel(scene: SampleScene): LeaguePanel {
  const autumn = autumnStanding(scene);
  const entered = scene.viewer === 'competitor';
  const row = (name: string, detail: string, action: TabAction) => ({
    name,
    detail,
    action,
  });
  const open = (slug: string) => linkTo('Open', tabRoutes.tournament(slug));
  const autumnRow = row(
    'Autumn Open',
    autumn.when === 'finished'
      ? `14 Nov · certified · ${autumn.fact}`
      : [
          ...(autumn.when === 'coming' ? ['Sat 14 Nov'] : []),
          ...(entered ? ['You are entered'] : []),
          'Varsity debate',
          autumn.fact,
        ].join(' · '),
    autumn.when === 'finished'
      ? linkTo('Results', tabRoutes.tournament(AUTUMN))
      : open(AUTUMN),
  );
  const groups = [
    { heading: 'Today', rows: autumn.when === 'today' ? [autumnRow] : [] },
    {
      heading: 'Coming up',
      rows: [
        ...(autumn.when === 'coming' ? [autumnRow] : []),
        row(
          'Ridgeview Invitational',
          'Sat 28 Nov · hosted by Ridgeview · entry closes 25 Nov',
          sampleAction('View'),
        ),
        row(
          'Winter Classic',
          `Sat 12 Dec · 8 events${entered ? ' · you are entered' : ''}`,
          open(WINTER),
        ),
        row('Championship', 'March · entry not open yet', sampleAction('View')),
      ],
    },
    {
      heading: 'Finished',
      rows: [
        ...(autumn.when === 'finished' ? [autumnRow] : []),
        row(
          'September Opener',
          `12 Sept · certified · ${entered ? 'you finished 9th of 40' : 'won by Castillo'}`,
          sampleAction('Results'),
        ),
      ],
    },
  ];
  return {
    kind: 'tournaments',
    groups: groups
      .filter((group) => group.rows.length > 0)
      .map((group) => ({ ...group, more: null })),
    note: 'All five count toward the 2026 to 27 season once their results are certified.',
  };
}

function panelOf(view: LeagueView, scene: SampleScene): LeaguePanel | null {
  switch (view.tab) {
    case 'rooms':
      return rooms;
    case 'ladder':
      return ladder(view.scope, view.search);
    case 'season':
      return seasonPanel(view.event);
    case 'tournaments':
      return tournamentsPanel(scene);
  }
}

/** Everyone signed in is a member of the sample league; a visitor is not. */
export const isMember = (scene: SampleScene): boolean =>
  scene.viewer !== 'visitor';

export function sampleLeagueLobby(
  slug: string,
  view: LeagueView,
  scene: SampleScene,
): LeagueLobby | null {
  if (slug !== LEAGUE) return null;
  const panel = panelOf(view, scene);
  if (panel === null) return null;
  return {
    name: LEAGUE_NAME,
    lede: 'League rating 1548 · 31st of 148',
    create: isMember(scene)
      ? linkTo('New room', tabRoutes.newLeagueRoom(LEAGUE), true)
      : null,
    tabs: tabs.map(([id, label]) => ({
      id,
      label,
      href: tabRoutes.league(LEAGUE, id),
      selected: id === view.tab,
    })),
    panel,
  };
}
