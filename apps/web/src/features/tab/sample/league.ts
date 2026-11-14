import { choice, linkTo, sampleAction, type TabAction } from '../action';
import type {
  CreateRoom,
  HostLeague,
  LeagueLobby,
  LeaguePanel,
  SeasonRow,
} from '../league';
import { hostRoutes, tabRoutes, type LeagueTab } from '../routes';
import type { ResolvedSetting, SettingScope } from '../settings';
import type { RailItem, TimelineRail } from '../tournament';
import { AUTUMN, LEAGUE, LEAGUE_NAME, reached, WINTER } from './moment';
import type { SampleScene } from './scene';
import { sampleTournaments } from './tournament';

const stop = (
  id: string,
  label: string,
  note: string | null,
  action: TabAction | null,
): RailItem => ({ id, label, time: null, note, action });

export function sampleLeagueRail(
  slug: string,
  scene: SampleScene,
): TimelineRail | null {
  if (slug !== LEAGUE) return null;
  return {
    title: LEAGUE_NAME,
    subtitle: '2026 to 27 season',
    heading: null,
    footHeading: null,
    items: [
      stop(
        'september-opener',
        'September Opener',
        'done',
        sampleAction('September Opener'),
      ),
      stop(
        AUTUMN,
        'Autumn Open',
        reached(scene, 'finished') ? 'done' : 'today',
        linkTo('Autumn Open', hostRoutes.tournament(AUTUMN)),
      ),
      stop(
        'ridgeview-invitational',
        'Ridgeview Invitational',
        'asks to count',
        linkTo('Ridgeview Invitational', hostRoutes.league(LEAGUE)),
      ),
      stop(
        WINTER,
        'Winter Classic',
        '12 Dec',
        linkTo('Winter Classic', hostRoutes.tournament(WINTER)),
      ),
      stop(
        'championship',
        'Championship',
        'March',
        sampleAction('Championship'),
      ),
    ],
    foot: [
      stop(
        'league',
        'League',
        null,
        linkTo('League', hostRoutes.league(LEAGUE)),
      ),
      stop(
        'people',
        'People',
        null,
        linkTo('People', hostRoutes.leaguePeople(LEAGUE)),
      ),
    ],
  };
}

const setting = (
  keys: readonly string[],
  label: string,
  value: string,
  hold: ResolvedSetting['hold'],
  scope: SettingScope = 'template',
  edit: TabAction | null = null,
): ResolvedSetting => ({
  keys,
  label,
  value,
  source: {
    scope,
    name: scope === 'template' ? 'the Varsity debate template' : LEAGUE_NAME,
  },
  hold,
  locked: false,
  attention: null,
  edit,
});

const season: readonly SeasonRow[] = [
  { place: 1, entry: 'Jensen · Hartwell', points: 18 },
  { place: 2, entry: 'Castillo · Ridgeview', points: 15 },
  { place: 3, entry: 'Amari · Lakeside', points: 14 },
];

const seasonNote =
  "From 1 certified tournament. Autumn Open is added when it's certified.";

export function sampleHostLeague(
  slug: string,
  _scene: SampleScene,
): HostLeague | null {
  if (slug !== LEAGUE) return null;
  const change = sampleAction('Change');
  return {
    name: LEAGUE_NAME,
    lede: '14 schools · 212 members · 9 rooms open in the lobby right now',
    lobbyView: linkTo('View the lobby as a member', tabRoutes.league(LEAGUE)),
    requests: [
      {
        event: 'Ridgeview Invitational',
        facts: 'Varsity debate · 28 Nov · hosted by Ridgeview',
        meets:
          'Follows your Varsity debate template, so it already meets everything the template enforces.',
        decline: sampleAction('Decline'),
        sanction: sampleAction('Sanction it', true),
      },
    ],
    template: {
      name: 'Varsity debate template',
      settings: [
        setting(['format'], 'Format', 'One-on-one, limited prep', 'enforced'),
        setting(
          ['ballot.definition'],
          'Ballot',
          '20 to 30 in halves, no low-point wins',
          'enforced',
        ),
        setting(
          ['standings.tiebreaks'],
          'Tiebreaks',
          "Wins, speaker points, opponents' wins, rating",
          'enforced',
        ),
        setting(
          ['pairing.preset'],
          'Pairing',
          'By record, no rematch',
          'default',
        ),
        setting(
          ['recording.capture', 'audience.video'],
          'Recording',
          'Recorded · video for officials only',
          'enforced',
        ),
      ],
      edit: sampleAction('Edit template'),
      note: 'anyone can copy it; an event that follows it can be sanctioned',
    },
    season: {
      heading: 'Season standings · Varsity',
      rows: season,
      note: seasonNote,
      rule: sampleAction('How points are counted'),
    },
    ladder: {
      detail:
        "Rates lobby rooms and tournaments run here. 148 members rated. Separate from Daisy's ladders.",
      open: linkTo('Open the ladder', tabRoutes.league(LEAGUE, 'ladder')),
    },
    lobby: [
      setting(
        ['audience.posting'],
        'Who can join',
        'Members of the 14 schools, and families the league has added',
        'default',
        'lobby',
        change,
      ),
      setting(
        ['room.own_format', 'resolution.rule', 'judging.members'],
        'Rooms members can open',
        "From the league's templates · resolution drawn from November's pool of 30 · members may judge each other",
        'default',
        'lobby',
        change,
      ),
      setting(
        ['ladder.counts'],
        'Lobby rooms count for',
        'The league ladder · not season standings',
        'default',
        'lobby',
        change,
      ),
    ],
  };
}

const tabs: readonly (readonly [LeagueTab, string])[] = [
  ['rooms', 'Rooms'],
  ['ladder', 'Ladder'],
  ['season', 'Season'],
  ['tournaments', 'Tournaments'],
];

function panelOf(tab: LeagueTab): LeaguePanel {
  switch (tab) {
    case 'rooms':
      return {
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
    case 'ladder':
      return {
        kind: 'ladder',
        rows: [
          {
            place: 1,
            name: 'Jensen',
            school: 'Hartwell',
            rating: 1712,
            you: false,
          },
          {
            place: 2,
            name: 'Castillo',
            school: 'Ridgeview',
            rating: 1655,
            you: false,
          },
          {
            place: 3,
            name: 'Amari',
            school: 'Lakeside',
            rating: 1641,
            you: false,
          },
          {
            place: 4,
            name: 'Wu',
            school: 'Lakeside',
            rating: 1622,
            you: false,
          },
          {
            place: 31,
            name: 'You',
            school: 'Ridgeview',
            rating: 1548,
            you: true,
          },
        ],
      };
    case 'season':
      return {
        kind: 'season',
        heading: 'Season standings · Varsity',
        rows: season,
        note: seasonNote,
      };
    case 'tournaments':
      return {
        kind: 'tournaments',
        tournaments: sampleTournaments.filter((tournament) =>
          tournament.detail.startsWith(LEAGUE_NAME),
        ),
      };
  }
}

export function sampleLeagueLobby(
  slug: string,
  tab: LeagueTab,
  _scene: SampleScene,
): LeagueLobby | null {
  if (slug !== LEAGUE) return null;
  return {
    name: LEAGUE_NAME,
    lede: 'League rating 1548 · 31st of 148',
    create: linkTo('New room', tabRoutes.newLeagueRoom(LEAGUE), true),
    tabs: tabs.map(([id, label]) => ({
      id,
      label,
      href: tabRoutes.league(LEAGUE, id),
      selected: id === tab,
    })),
    panel: panelOf(tab),
  };
}

export function sampleCreateRoom(
  slug: string,
  _scene: SampleScene,
): CreateRoom | null {
  if (slug !== LEAGUE) return null;
  const enforced = (keys: readonly string[], label: string, value: string) => ({
    ...setting(keys, label, value, 'enforced'),
    locked: true,
  });
  return {
    lobby: { name: LEAGUE_NAME, href: tabRoutes.league(LEAGUE) },
    template: choice('Template', [
      'Varsity debate',
      'Novice debate',
      'Impromptu',
    ]),
    locked: [
      enforced(['format'], 'Format', 'One-on-one, limited prep'),
      enforced(
        ['ballot.definition'],
        'Ballot',
        '20 to 30 in halves, no low-point wins',
      ),
      enforced(
        ['resolution.rule'],
        'Resolution',
        "Struck from five drawn from November's pool",
      ),
      enforced(
        ['recording.capture', 'audience.video'],
        'Recording',
        'Recorded · video for officials only',
      ),
    ],
    defaults: [
      choice('Judge', ['A member judges', 'No judge, not rated']),
      choice('Counts for the league ladder', ['Yes', 'No']),
      choice('Who can watch', [
        'Members of the league',
        'Only the people in the room',
      ]),
    ],
    open: sampleAction('Open room', true),
  };
}
