import type {
  ListedLobby,
  LobbyListPage,
  TournamentLobbyView,
} from '@daisy/protocol/lobby/lobby-read';
import { hostRoutes, tabRoutes } from '../routes';
import type {
  AddressOf,
  TabPlace,
  TournamentReads,
  TournamentView,
} from '../tournament';
import {
  AUTUMN,
  CHAMPIONSHIP,
  LEAGUE,
  LEAGUE_NAME,
  reached,
  SCRIMMAGE,
  VARSITY,
  WINTER,
} from './moment';
import {
  at,
  dayFixture,
  dayOf,
  dayRow,
  daySlot,
  judge,
  postedFixture,
  postingOf,
  sampleId,
  tabRound,
  versus,
} from './posting';
import { sampleRoomIds } from './rooms';
import type { SampleScene } from './scene';
import { autumnAsOf, autumnReads } from './tournament-autumn';
import { winterReads } from './tournament-winter';

const league = {
  kind: 'organization',
  organizationId: sampleId(LEAGUE),
  organizationKind: 'league',
  name: LEAGUE_NAME,
} as const;

/** The parts of a tournament lobby read that a sample does not vary. */
const quiet: Pick<
  TournamentLobbyView,
  | 'certifiedAt'
  | 'entered'
  | 'terms'
  | 'break'
  | 'viewerEntries'
  | 'wards'
  | 'school'
  | 'results'
  | 'host'
  | 'capabilities'
  | 'events'
  | 'timeSlots'
> = {
  certifiedAt: null,
  entered: null,
  terms: [],
  break: null,
  viewerEntries: [],
  wards: [],
  school: null,
  results: { standings: false, bracket: 'closed', scoresOpenAt: null },
  host: null,
  capabilities: { enter: true, manageEntries: false },
  events: [],
  timeSlots: [],
};

const viewerRolesOf = (
  scene: SampleScene,
): TournamentLobbyView['viewerRoles'] =>
  scene.viewer === 'visitor'
    ? []
    : scene.viewer === 'coach' || scene.viewer === 'parent'
      ? ['responsible_adult']
      : [scene.viewer];

const scrimmage = (scene: SampleScene): TournamentLobbyView => ({
  ...quiet,
  kind: 'tournament',
  lobbyId: sampleId(SCRIMMAGE),
  handle: SCRIMMAGE,
  name: 'Friday scrimmage',
  owner: { kind: 'person', actorId: sampleId('jono'), username: 'jono' },
  signedIn: scene.viewer !== 'visitor',
  viewerRoles: [],
  asOf: autumnAsOf(scene),
  status: 'open',
  startsAt: at('2026-11-20', '18:00'),
  place: 'online',
  entry: {
    opensAt: null,
    closesAt: at('2026-11-20', '17:00'),
    capacity: 16,
    taken: 9,
    eligibility: 'anyone',
    limit: null,
  },
  entered: {
    kind: 'people',
    people: [
      { username: 'mira_k', rating: 1688 },
      { username: 'tobias', rating: 1640 },
      { username: 'devon.w', rating: 1611 },
      { username: 'r_haddad', rating: 1570 },
    ],
    more: 5,
  },
  terms: [
    {
      title: 'Single elimination',
      detail:
        'Seeded by your Daisy rating when entry closes. Four rounds, about 35 minutes each.',
    },
    {
      title: 'One-on-one, limited prep',
      detail:
        'You strike from five resolutions in the room, then 20 minutes to prepare.',
    },
    {
      title: 'Judged by people in the bracket',
      detail:
        "If you're knocked out you may be asked to judge a later round. Three judges in the final.",
    },
    {
      title: 'Recorded',
      detail:
        'Rounds are recorded and released to the people in them. Results are public.',
    },
    {
      title: "Doesn't change your rating",
      detail: 'Tournament results stay in the tournament.',
    },
  ],
});

const BP = { key: 'british-parliamentary', name: 'British Parliamentary' };
const CHAMPIONSHIP_DAY = '2027-03-13';

function championship(scene: SampleScene): TournamentReads {
  const roundTwo = tabRound(CHAMPIONSHIP, BP.key, 2, 'Round 2');
  const lobby: TournamentLobbyView = {
    ...quiet,
    kind: 'tournament',
    lobbyId: sampleId(CHAMPIONSHIP),
    handle: CHAMPIONSHIP,
    name: 'Championship',
    owner: league,
    signedIn: scene.viewer !== 'visitor',
    viewerRoles: viewerRolesOf(scene),
    asOf: at(CHAMPIONSHIP_DAY, '14:44'),
    status: 'running',
    startsAt: at(CHAMPIONSHIP_DAY, '13:00'),
    place: 'online',
    entry: {
      opensAt: null,
      closesAt: at('2027-03-10', '17:00'),
      capacity: null,
      taken: 24,
      eligibility: 'organization_added',
      limit: null,
    },
    events: [{ eventId: sampleId(`${CHAMPIONSHIP}/${BP.key}`), name: BP.name }],
    timeSlots: [
      {
        timeSlotId: sampleId(`${CHAMPIONSHIP}/slot/1`),
        name: 'Round 1',
        startsAt: at(CHAMPIONSHIP_DAY, '13:00'),
        tabRounds: [
          { ...tabRound(CHAMPIONSHIP, BP.key, 1, 'Round 1'), posting: false },
        ],
      },
      {
        timeSlotId: sampleId(`${CHAMPIONSHIP}/slot/2`),
        name: 'Round 2',
        startsAt: at(CHAMPIONSHIP_DAY, '14:50'),
        tabRounds: [{ ...roundTwo, posting: true }],
      },
    ],
    break: { at: at(CHAMPIONSHIP_DAY, '18:00'), announced: false },
    viewerEntries:
      scene.viewer === 'competitor'
        ? [
            {
              entryId: sampleId('entry/Ridgeview B'),
              eventId: sampleId(`${CHAMPIONSHIP}/${BP.key}`),
              name: 'Ridgeview B',
              partners: ['Okoye'],
              record: null,
              finish: null,
            },
          ]
        : [],
  };
  const room4 = 'championship-round-2-room-4';
  const chair = [judge('Malik', true), judge('Nguyen'), judge('Costa')];
  return {
    lobby,
    posting: postingOf(
      CHAMPIONSHIP,
      BP,
      roundTwo,
      { opensAt: at(CHAMPIONSHIP_DAY, '14:50'), startedAt: null },
      6,
      [
        postedFixture(
          room4,
          'Room 4',
          versus('Hartwell A, Ridgeview B, Lakeside A, Ridgeview C'),
          chair,
        ),
        postedFixture(
          `${CHAMPIONSHIP}/round-2/room-5`,
          'Room 5',
          versus('Lakeside B, Hartwell B, Ridgeview A, Okafor family'),
          [judge('Abara', true), judge('Keane'), judge('Shah')],
        ),
      ],
      4,
    ),
    day:
      scene.viewer === 'competitor'
        ? dayOf(CHAMPIONSHIP, lobby.asOf, [
            daySlot(CHAMPIONSHIP, 'Round 2', at(CHAMPIONSHIP_DAY, '14:50'), [
              dayRow(
                CHAMPIONSHIP,
                BP,
                { number: 2, name: 'Round 2' },
                {
                  role: 'competitor',
                  entry: {
                    entryId: sampleId('entry/Ridgeview B'),
                    name: 'Ridgeview B',
                    record: null,
                  },
                  fixture: dayFixture(
                    room4,
                    'Room 4',
                    [
                      { name: 'Hartwell A', side: 'Opening Government' },
                      {
                        name: 'Ridgeview B',
                        side: 'Opening Opposition',
                        own: true,
                      },
                      { name: 'Lakeside A', side: 'Closing Government' },
                      { name: 'Ridgeview C', side: 'Closing Opposition' },
                    ],
                    chair,
                  ),
                  state: {
                    kind: 'posted',
                    opensAt: at(CHAMPIONSHIP_DAY, '14:50'),
                  },
                },
              ),
            ]),
          ])
        : null,
    standings: null,
    bracket: null,
  };
}

/** Everything a sample tournament's participant page reads for one view. */
export function sampleTournamentReads(
  slug: string,
  view: TournamentView,
  scene: SampleScene,
): TournamentReads | null {
  if (slug === AUTUMN) return autumnReads(view, scene);
  if (slug === WINTER) return winterReads(view, scene);
  if (slug === CHAMPIONSHIP) return championship(scene);
  if (slug === SCRIMMAGE && view.kind === 'home')
    return {
      lobby: scrimmage(scene),
      posting: null,
      day: null,
      standings: null,
      bracket: null,
    };
  return null;
}

// The lobby list.

type ListedTournament = Extract<ListedLobby, { kind: 'tournament' }>;

const listed = (
  handle: string,
  name: string,
  rest: Omit<ListedTournament, 'kind' | 'lobbyId' | 'handle' | 'name'>,
): ListedTournament => ({
  kind: 'tournament',
  lobbyId: sampleId(handle),
  handle,
  name,
  ...rest,
});

const autumnEvents = ['Varsity debate', 'Novice debate', 'Impromptu'];
const winterEvents = [
  'Varsity LD',
  'Novice LD',
  'Varsity PF',
  'Parli',
  'Impromptu',
  'Oratory',
  'Extemp',
  'Interp',
];

/** What ties each sample viewer to the tournaments they are in. */
function partOf(
  scene: SampleScene,
  events: [string, ...string[]],
  judging: [string, ...string[]],
): ListedTournament['part'] {
  switch (scene.viewer) {
    case 'competitor':
      return { kind: 'competitor', events };
    case 'judge':
      return { kind: 'judge', events: judging };
    case 'coach':
      return { kind: 'school', school: 'Hartwell' };
    case 'parent':
      return { kind: 'guardian', wards: ['Chidi', 'Ada'] };
    case 'host':
      return { kind: 'host' };
    case 'visitor':
      return null;
  }
}

const closedEntry = (closesAt: string) => ({
  opensAt: null,
  closesAt,
  capacity: null,
  taken: 0,
  eligibility: 'organization_added' as const,
  limit: null,
});

/** Autumn Open in a list, where the sample day has got to. */
export function listedAutumn(scene: SampleScene): ListedTournament {
  const finished = reached(scene, 'finished');
  return listed(AUTUMN, 'Autumn Open', {
    owner: league,
    hostedBy: null,
    status: finished
      ? 'completed'
      : reached(scene, 'prelims')
        ? 'running'
        : 'open',
    startsAt: at('2026-11-14', '10:00'),
    events: autumnEvents,
    concurrentEvents: false,
    entry: {
      ...closedEntry(at('2026-11-12', '17:00')),
      capacity: 48,
      taken: 31,
    },
    part: partOf(scene, ['Varsity debate'], ['Varsity debate']),
    now:
      finished || !reached(scene, 'prelims')
        ? null
        : reached(scene, 'elims')
          ? { kind: 'live', tabRoundName: 'semifinals' }
          : reached(scene, 'break')
            ? { kind: 'break_at', at: at('2026-11-14', '16:45') }
            : {
                kind: 'round_opens',
                tabRoundName: 'Round 4',
                at: at('2026-11-14', '15:20'),
              },
    finish: finished
      ? {
          winner: 'Jensen',
          viewer: scene.viewer === 'competitor' ? { place: 3, of: 48 } : null,
        }
      : null,
  });
}

export const listedWinter = (scene: SampleScene): ListedTournament =>
  listed(WINTER, 'Winter Classic', {
    owner: league,
    hostedBy: null,
    status: 'open',
    startsAt: at('2026-12-12', '09:00'),
    events: winterEvents,
    concurrentEvents: true,
    entry: {
      ...closedEntry(at('2026-12-09', '17:00')),
      opensAt: at('2026-12-01', '09:00'),
      limit: 'one debate event, one Speech A and one Speech B each',
    },
    part: partOf(scene, ['Parli', 'Impromptu'], ['Parli']),
    now: null,
    finish: null,
  });

export const listedRidgeview = listed(
  'ridgeview-invitational',
  'Ridgeview Invitational',
  {
    owner: league,
    hostedBy: 'Ridgeview',
    status: 'open',
    startsAt: at('2026-11-28', '09:00'),
    events: [],
    concurrentEvents: false,
    entry: {
      ...closedEntry(at('2026-11-25', '17:00')),
      eligibility: 'organization_members',
    },
    part: null,
    now: null,
    finish: null,
  },
);

export const listedChampionship = listed(CHAMPIONSHIP, 'Championship', {
  owner: league,
  hostedBy: null,
  status: 'draft',
  startsAt: at(CHAMPIONSHIP_DAY, '09:00'),
  events: [BP.name],
  concurrentEvents: false,
  entry: {
    ...closedEntry(at('2027-03-10', '17:00')),
    opensAt: at('2027-02-01', '09:00'),
  },
  part: null,
  now: null,
  finish: null,
});

export const listedOpener = (scene: SampleScene): ListedTournament =>
  listed('september-opener', 'September Opener', {
    owner: league,
    hostedBy: null,
    status: 'completed',
    startsAt: at('2026-09-12', '10:00'),
    events: ['Varsity debate'],
    concurrentEvents: false,
    entry: closedEntry(at('2026-09-10', '17:00')),
    part: null,
    now: null,
    finish: {
      winner: 'Castillo',
      viewer: scene.viewer === 'competitor' ? { place: 9, of: 40 } : null,
    },
  });

/** The tournaments a viewer may see, theirs first, as the index lists them. */
export function sampleTournamentListRead(scene: SampleScene): LobbyListPage {
  const visitor = scene.viewer === 'visitor';
  const scrimmageRead = scrimmage(scene);
  return {
    asOf: autumnAsOf(scene),
    lobbies: [
      listedAutumn(scene),
      ...(visitor ? [] : [listedWinter(scene)]),
      listed(SCRIMMAGE, scrimmageRead.name, {
        owner: scrimmageRead.owner,
        hostedBy: null,
        status: 'open',
        startsAt: scrimmageRead.startsAt,
        events: ['Single elimination'],
        concurrentEvents: false,
        entry: scrimmageRead.entry,
        part: null,
        now: null,
        finish: null,
      }),
      ...(visitor ? [] : [listedRidgeview]),
      listedOpener(scene),
      listed('public-beta-open', 'Public Beta Open', {
        owner: {
          kind: 'organization',
          organizationId: sampleId('daisy'),
          organizationKind: 'league',
          name: 'Daisy',
        },
        hostedBy: null,
        status: 'completed',
        startsAt: at('2026-10-03', '10:00'),
        events: ['Open'],
        concurrentEvents: false,
        entry: closedEntry(at('2026-10-01', '17:00')),
        part: null,
        now: null,
        finish: { winner: 'mira_k', viewer: null },
      }),
    ],
    more: 0,
    capabilities: visitor ? null : { createLobby: true },
  };
}

// Where the sample's places live.

/** The sample's events, by the key its addresses use. */
const eventKeys = new Map(
  [
    [AUTUMN, [VARSITY, 'novice-debate', 'impromptu']],
    [
      WINTER,
      [
        'varsity-ld',
        'novice-ld',
        'varsity-pf',
        'parli',
        'impromptu',
        'oratory',
        'extemp',
        'interp',
      ],
    ],
    [CHAMPIONSHIP, [BP.key]],
  ].flatMap(([lobby, keys]) =>
    (keys as readonly string[]).map((key) => [
      sampleId(`${String(lobby)}/${key}`),
      key,
    ]),
  ),
);
const roomKeys = new Map(sampleRoomIds.map((key) => [sampleId(key), key]));
/** The sample's pages: which tournaments and host pages it has. */
const tournamentPages = new Set([AUTUMN, WINTER, SCRIMMAGE, CHAMPIONSHIP]);
const hostPages: Readonly<Record<string, readonly string[]>> = {
  [AUTUMN]: ['setup', 'events', 'entries', 'people', 'standings', 'results'],
  [WINTER]: ['events', 'people'],
};
const winterSlot = sampleId(`${WINTER}/slot/${at('2026-12-12', '12:00')}`);

/** Where each place the sample has a page for lives; null where it has none. */
export const sampleAddressOf: AddressOf = (place: TabPlace) => {
  switch (place.kind) {
    case 'tournament':
      return tournamentPages.has(place.handle)
        ? tabRoutes.tournament(place.handle)
        : null;
    case 'round': {
      const event = eventKeys.get(place.eventId);
      return event === undefined
        ? null
        : tabRoutes.round(place.handle, event, String(place.number));
    }
    case 'standings':
      return tabRoutes.standings(place.handle);
    case 'bracket':
      return tabRoutes.bracket(place.handle);
    case 'entries':
      return tabRoutes.entries(place.handle);
    case 'room': {
      const room = roomKeys.get(place.roomId);
      return room === undefined ? null : tabRoutes.room(room);
    }
    case 'live_room': {
      const room = roomKeys.get(place.roomId);
      return room === 'impromptu-section-c' ? tabRoutes.liveRoom(room) : null;
    }
    case 'ballot': {
      const room = roomKeys.get(place.roomId);
      return room === undefined ? null : tabRoutes.ballot(room);
    }
    case 'host':
      if (!(hostPages[place.handle] ?? []).includes(place.page)) return null;
      switch (place.page) {
        case 'setup':
          return hostRoutes.setup(place.handle);
        case 'events':
          return hostRoutes.events(place.handle);
        case 'entries':
          return hostRoutes.entries(place.handle);
        case 'people':
          return hostRoutes.people(place.handle);
        case 'standings':
          return hostRoutes.standings(place.handle);
        case 'results':
          return hostRoutes.results(place.handle);
      }
      return null;
    case 'host_round': {
      const event = eventKeys.get(place.eventId);
      return event === undefined || place.handle !== AUTUMN
        ? null
        : hostRoutes.round(place.handle, event, String(place.number));
    }
    case 'host_slot':
      return place.timeSlotId === winterSlot
        ? hostRoutes.slot(place.handle, '1200')
        : null;
    case 'past_tournaments':
      return null;
  }
};
