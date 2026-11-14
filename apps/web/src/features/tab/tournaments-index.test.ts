import {
  lobbyListQuerySchema,
  lobbyListPageSchema,
  type ListedLobby,
  type LobbyListPage,
} from '@daisy/protocol/lobby/lobby-read';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleCatalogue } from './sample/tournament-catalogue';
import { sampleTournamentListRead } from './sample/tournament';
import {
  indexHref,
  indexStateOf,
  lobbyListQueryOf,
  readTournamentsIndex,
  tournamentsIndexOf,
  type IndexParams,
  type TournamentsIndex,
} from './tournaments-index';

setupRitewayBun();

type Listed = Extract<ListedLobby, { kind: 'tournament' }>;

const asOf = '2026-11-14T14:00:00.000Z';
const atlanta = {
  place: 'in_person',
  city: 'Atlanta, GA',
  latitude: 33.749,
  longitude: -84.388,
} as const;
const marietta = {
  place: 'in_person',
  city: 'Marietta, GA',
  latitude: 33.953,
  longitude: -84.55,
} as const;
const chicago = {
  place: 'in_person',
  city: 'Chicago, IL',
  latitude: 41.878,
  longitude: -87.63,
} as const;
const places = [atlanta, marietta, chicago];

const league = (name: string) =>
  ({
    kind: 'organization',
    organizationId: 'a'.repeat(24),
    organizationKind: 'league',
    name,
  }) as const;

let made = 0;
/** One listed tournament: open for entry on 21 Nov unless told otherwise. */
const listed = (name: string, rest: Partial<Listed> = {}): Listed => {
  made += 1;
  return {
    kind: 'tournament',
    lobbyId: String(made).padStart(24, 'x'),
    handle: name.toLowerCase().replaceAll(' ', '-'),
    name,
    owner: league('Southeast League'),
    hostedBy: null,
    status: 'open',
    startsAt: '2026-11-21T09:00:00.000Z',
    events: ['Public Forum'],
    concurrentEvents: false,
    divisions: ['varsity'],
    venue: { place: 'online' },
    entry: {
      opensAt: null,
      closesAt: '2026-11-18T17:00:00.000Z',
      capacity: null,
      taken: 10,
      eligibility: 'anyone',
      limit: null,
    },
    part: null,
    now: null,
    finish: null,
    ...rest,
  };
};

const pageOf = (lobbies: readonly Listed[]): LobbyListPage => ({
  asOf,
  lobbies: [...lobbies],
  more: 0,
  capabilities: { createLobby: true },
});

const addressOf = () => null;

const indexOf = (
  lobbies: readonly Listed[],
  params: IndexParams = {},
): TournamentsIndex =>
  tournamentsIndexOf(
    pageOf(lobbies),
    indexStateOf(params, places),
    addressOf,
    places,
  );

/** The names the list shows, in order. */
const namesIn = (index: TournamentsIndex): readonly string[] =>
  index.list?.days.flatMap((group) => group.rows.map((row) => row.name)) ?? [];

describe('the tournaments index: search', () => {
  test('a tournament, a league or a school', () => {
    const lobbies = [
      listed('Peachtree Invitational'),
      listed('Bayou Classic', { owner: league('Gulf Coast League') }),
      listed('Hilltop Swing', { hostedBy: 'Ridgeview High' }),
    ];
    assert({
      given: 'a search for part of a name, a league and a school, in any case',
      should: 'find each by what it matched',
      actual: [
        namesIn(indexOf(lobbies, { q: 'peachtree' })),
        namesIn(indexOf(lobbies, { q: 'GULF' })),
        namesIn(indexOf(lobbies, { q: 'ridgeview' })),
      ],
      expected: [
        ['Peachtree Invitational'],
        ['Bayou Classic'],
        ['Hilltop Swing'],
      ],
    });
  });
});

describe('the tournaments index: filters', () => {
  const lobbies = [
    listed('Varsity LD Cup', {
      events: ['Varsity LD'],
      divisions: ['varsity'],
      venue: atlanta,
    }),
    listed('Novice PF Open', {
      events: ['Public Forum'],
      divisions: ['novice'],
      owner: league('Capital Debate League'),
      startsAt: '2026-11-28T09:00:00.000Z',
    }),
    listed('Marietta Swing', {
      events: ['Parli'],
      divisions: ['jv'],
      venue: marietta,
      startsAt: '2026-12-05T09:00:00.000Z',
    }),
    listed('Chicago Classic', {
      events: ['Policy'],
      divisions: ['open'],
      venue: chicago,
      entry: {
        opensAt: null,
        closesAt: '2026-11-18T17:00:00.000Z',
        capacity: 16,
        taken: 16,
        eligibility: 'anyone',
        limit: null,
      },
    }),
  ];
  test('format or event, league, division', () => {
    assert({
      given:
        'Lincoln-Douglas (an event called Varsity LD), a league, a division',
      should: 'keep only the tournaments that run it',
      actual: [
        namesIn(indexOf(lobbies, { format: 'Lincoln-Douglas' })),
        namesIn(indexOf(lobbies, { league: 'Capital Debate League' })),
        namesIn(indexOf(lobbies, { division: 'jv' })),
      ],
      expected: [['Varsity LD Cup'], ['Novice PF Open'], ['Marietta Swing']],
    });
  });

  test('online or in person, and near me', () => {
    assert({
      given: 'online, in person, and within 50 miles of Atlanta',
      should:
        'split by where they run, and keep Atlanta and Marietta but not Chicago',
      actual: [
        namesIn(indexOf(lobbies, { mode: 'online' })),
        namesIn(indexOf(lobbies, { mode: 'in_person' })),
        namesIn(indexOf(lobbies, { near: 'Atlanta, GA' })),
      ],
      expected: [
        ['Novice PF Open'],
        ['Chicago Classic', 'Varsity LD Cup', 'Marietta Swing'],
        ['Varsity LD Cup', 'Marietta Swing'],
      ],
    });
    assert({
      given: 'near me asked with online',
      should: 'drop near me, which is in person only',
      actual: indexStateOf({ mode: 'online', near: 'Atlanta, GA' }, places)
        .near,
      expected: null,
    });
  });

  test('dates and entry open', () => {
    assert({
      given: 'from 28 Nov, to 28 Nov, and entry open',
      should:
        'keep those starting on or after, on or before, and those with a place to take now',
      actual: [
        namesIn(indexOf(lobbies, { from: '2026-11-28' })),
        namesIn(indexOf(lobbies, { to: '2026-11-28' })),
        namesIn(indexOf(lobbies, { open: '1' })),
      ],
      expected: [
        ['Novice PF Open', 'Marietta Swing'],
        ['Chicago Classic', 'Varsity LD Cup', 'Novice PF Open'],
        ['Varsity LD Cup', 'Novice PF Open', 'Marietta Swing'],
      ],
    });
  });

  test('chips, their removal and Clear', () => {
    const index = indexOf(lobbies, {
      division: 'varsity',
      mode: 'in_person',
      near: 'Atlanta, GA',
      open: '1',
      view: 'calendar',
    });
    assert({
      given: 'varsity, in person near Atlanta, entry open, on the calendar',
      should:
        'show a chip each whose link drops only it (in person takes near me with it), count four filters and clear to the calendar',
      actual: {
        chips: index.chips.map((chip) => [chip.label, chip.remove]),
        active: index.active,
        clear: index.clear,
      },
      expected: {
        chips: [
          [
            'Varsity',
            '/tournaments?mode=in_person&near=Atlanta%2C+GA&open=1&view=calendar',
          ],
          ['In person', '/tournaments?division=varsity&open=1&view=calendar'],
          [
            'Within 50 miles of Atlanta, GA',
            '/tournaments?division=varsity&mode=in_person&open=1&view=calendar',
          ],
          [
            'Entry open',
            '/tournaments?division=varsity&mode=in_person&near=Atlanta%2C+GA&view=calendar',
          ],
        ],
        active: 4,
        clear: '/tournaments?view=calendar',
      },
    });
    assert({
      given: 'no filter set',
      should: 'show no chips and nothing to clear',
      actual: [indexOf(lobbies).chips, indexOf(lobbies).clear],
      expected: [[], null],
    });
  });
});

describe('the tournaments index: tabs and You are in', () => {
  const lobbies = [
    listed('Autumn Open', {
      status: 'running',
      startsAt: '2026-11-14T10:00:00.000Z',
      part: { kind: 'competitor', events: ['Varsity debate'] },
      now: {
        kind: 'round_opens',
        tabRoundName: 'Round 4',
        at: '2026-11-14T15:20:00.000Z',
      },
    }),
    listed('Winter Classic', {
      startsAt: '2026-12-12T09:00:00.000Z',
      part: { kind: 'competitor', events: ['Parli', 'Impromptu'] },
    }),
    listed('Bayou Classic'),
    listed('September Opener', {
      status: 'completed',
      startsAt: '2026-09-12T10:00:00.000Z',
      part: { kind: 'competitor', events: ['Varsity debate'] },
      finish: { winner: 'Castillo', viewer: null },
    }),
  ];
  test('pinned, whatever the filters', () => {
    const index = indexOf(lobbies, { q: 'bayou' });
    assert({
      given: 'a viewer in two running or coming tournaments and one past',
      should: 'pin the two, soonest first, each opened by an Open button',
      actual: index.yours.map((row) => [
        row.name,
        row.detail,
        row.action.label,
      ]),
      expected: [
        ['Autumn Open', 'Today · Round 4 opens 15:20', 'Open'],
        ['Winter Classic', 'Sat 12 Dec · Parli and Impromptu', 'Open'],
      ],
    });
  });

  test('upcoming, live now and past', () => {
    const index = indexOf(lobbies);
    assert({
      given: 'the index on each tab',
      should: 'count the upcoming and live, and list each tab its own',
      actual: {
        tabs: index.tabs.map((tab) => [tab.label, tab.count, tab.href]),
        live: namesIn(indexOf(lobbies, { tab: 'live' })),
        past: namesIn(indexOf(lobbies, { tab: 'past' })),
      },
      expected: {
        tabs: [
          ['Upcoming', 2, '/tournaments'],
          ['Live now', 1, '/tournaments?tab=live'],
          ['Past', null, '/tournaments?tab=past'],
        ],
        live: ['Autumn Open'],
        past: ['September Opener'],
      },
    });
  });
});

describe('the tournaments index: groups and pages', () => {
  // 25 tournaments, five a day from Friday 20 Nov to Tuesday 24 Nov.
  const days = ['20', '21', '22', '23', '24'];
  const many = days.flatMap((day) =>
    ['A', 'B', 'C', 'D', 'E'].map((letter) =>
      listed(`${letter} ${day}`, { startsAt: `2026-11-${day}T09:00:00.000Z` }),
    ),
  );

  test('by day on the phone, by week on the desktop', () => {
    const list = indexOf(many).list;
    assert({
      given: 'twenty of twenty-five tournaments shown, over a weekend',
      should:
        'head each day and each Sunday-to-Saturday week with its whole count',
      actual: {
        days: list?.days.map((group) => [
          group.heading,
          group.count,
          group.rows.length,
        ]),
        weeks: list?.weeks.map((group) => [
          group.heading,
          group.count,
          group.rows.length,
        ]),
      },
      expected: {
        days: [
          ['Fri 20 Nov', 5, 5],
          ['Sat 21 Nov', 5, 5],
          ['Sun 22 Nov', 5, 5],
          ['Mon 23 Nov', 5, 5],
        ],
        weeks: [
          ['15 to 21 Nov', 10, 10],
          ['22 to 28 Nov', 15, 10],
        ],
      },
    });
    const late = listed('Late', { startsAt: '2026-12-01T09:00:00.000Z' });
    assert({
      given: 'a week that crosses into December',
      should: 'name both months',
      actual: indexOf([late]).list?.weeks.map((group) => group.heading),
      expected: ['29 Nov to 5 Dec'],
    });
  });

  test('20 of N shown, and show more', () => {
    const first = indexOf(many).list?.paging;
    const second = indexOf(many, { shown: '25' }).list?.paging;
    assert({
      given: 'the first page of twenty-five, then all of them',
      should: 'say how many show and offer the rest, then nothing more',
      actual: [first, second],
      expected: [
        {
          summary: '20 of 25 shown',
          more: { label: 'Show 5 more', href: '/tournaments?shown=25' },
        },
        { summary: '25 of 25 shown', more: null },
      ],
    });
    const hundred = Array.from({ length: 50 }, (_, n) =>
      listed(`T${n}`, { startsAt: '2026-11-21T09:00:00.000Z' }),
    );
    assert({
      given: 'fifty tournaments',
      should: 'offer twenty more',
      actual: indexOf(hundred).list?.paging,
      expected: {
        summary: '20 of 50 shown',
        more: { label: 'Show 20 more', href: '/tournaments?shown=40' },
      },
    });
  });
});

describe('the tournaments index: calendar', () => {
  const lobbies = [
    ...Array.from({ length: 9 }, (_, n) => listed(`Sat ${n}`)),
    listed('Friday scrimmage', { startsAt: '2026-11-20T18:00:00.000Z' }),
    listed('December Cup', { startsAt: '2026-12-05T09:00:00.000Z' }),
    listed('Gone', {
      status: 'completed',
      startsAt: '2026-11-07T09:00:00.000Z',
    }),
  ];
  const cell = (index: TournamentsIndex, date: string) =>
    index.calendar?.weeks.flat().find((day) => day.date === date);

  test('a month with counts by day', () => {
    const index = indexOf(lobbies, { view: 'calendar' });
    assert({
      given: 'the calendar in the current month',
      should:
        'count each coming day, link the days with tournaments, leave past days uncounted, and step only forward',
      actual: {
        title: index.calendar?.title,
        first: index.calendar?.weeks[0]?.[0]?.date,
        fri: [
          cell(index, '2026-11-20')?.count,
          cell(index, '2026-11-20')?.href,
        ],
        sat: [
          cell(index, '2026-11-21')?.count,
          cell(index, '2026-11-21')?.href,
        ],
        past: cell(index, '2026-11-07')?.count,
        empty: cell(index, '2026-11-19')?.href,
        previous: index.calendar?.previous,
        next: index.calendar?.next,
      },
      expected: {
        title: 'November 2026',
        first: '2026-11-01',
        fri: [1, '/tournaments?view=calendar&day=2026-11-20'],
        sat: [9, '/tournaments?view=calendar&day=2026-11-21'],
        past: 0,
        empty: null,
        previous: null,
        next: '/tournaments?view=calendar&month=2026-12',
      },
    });
  });

  test('picking a day', () => {
    const index = indexOf(lobbies, { view: 'calendar', day: '2026-11-21' });
    const all = indexOf(lobbies, {
      view: 'calendar',
      day: '2026-11-21',
      shown: '9',
    });
    assert({
      given: 'Saturday 21 Nov picked, then all of it',
      should: "list that day's tournaments a page at a time, then all nine",
      actual: {
        selected: cell(index, '2026-11-21')?.selected,
        heading: index.calendar?.day?.heading,
        count: index.calendar?.day?.count,
        paging: index.calendar?.day?.paging,
        all: all.calendar?.day?.rows.length,
      },
      expected: {
        selected: true,
        heading: 'Sat 21 Nov',
        count: 9,
        paging: {
          summary: '5 of 9 shown',
          more: {
            label: 'Show all 9',
            href: '/tournaments?view=calendar&day=2026-11-21&shown=9',
          },
        },
        all: 9,
      },
    });
    const today = indexOf(lobbies, { view: 'calendar' });
    assert({
      given: 'the calendar with no day picked',
      should: 'pick today',
      actual: today.calendar?.day?.heading,
      expected: 'Sat 14 Nov',
    });
  });
});

describe('the tournaments index: its address', () => {
  test('read, written and asked of the read', () => {
    const params = {
      q: 'peach',
      format: 'Public Forum',
      division: 'varsity',
      from: '2026-11-14',
      to: '2026-11-30',
      open: '1',
      view: 'calendar',
      month: '2026-12',
      day: '2026-12-05',
    };
    const state = indexStateOf(params, places);
    assert({
      given: 'an address setting filters and a calendar day',
      should: 'write the same address back, in one order',
      actual: indexHref(state),
      expected:
        '/tournaments?q=peach&format=Public+Forum&division=varsity&from=2026-11-14&to=2026-11-30&open=1&view=calendar&month=2026-12&day=2026-12-05',
    });
    assert({
      given: 'the same state asked of the lobby list',
      should: 'be a query its contract accepts',
      actual: lobbyListQuerySchema.safeParse(lobbyListQueryOf(state)).success,
      expected: true,
    });
    assert({
      given: 'an address of nonsense',
      should: 'read as the plain index',
      actual: indexHref(
        indexStateOf(
          {
            division: 'expert',
            mode: 'boat',
            from: '2026-02-31',
            view: 'map',
            tab: 'soon',
            shown: '-4',
            near: 'Atlantis',
          },
          places,
        ),
      ),
      expected: '/tournaments',
    });
  });
});

describe('the sample index', () => {
  test('a few hundred tournaments, the named ones among them', () => {
    const scene = {
      viewer: 'competitor',
      moment: 'prelims',
      scale: 'normal',
    } as const;
    const names = sampleTournamentListRead(scene).lobbies.map(
      (one) => one.name,
    );
    const index = readTournamentsIndex(scene);
    assert({
      given: 'the sample list for a competitor during prelims',
      should:
        'hold the named tournaments and hundreds more, each handle once, Autumn Open and Winter Classic pinned',
      actual: {
        named: ['Autumn Open', 'Winter Classic', 'Friday scrimmage'].every(
          (name) => names.includes(name),
        ),
        hundreds: sampleCatalogue.length >= 300,
        unique:
          new Set(sampleCatalogue.map((one) => one.handle)).size ===
          sampleCatalogue.length,
        yours: index.yours.map((row) => row.name),
        paging: index.list?.paging.summary.startsWith('20 of '),
      },
      expected: {
        named: true,
        hundreds: true,
        unique: true,
        yours: ['Autumn Open', 'Winter Classic'],
        paging: true,
      },
    });
  });
});

test('the full sample catalogue and pages past one hundred stay within the read contract', () => {
  const page = sampleTournamentListRead({
    viewer: 'competitor',
    moment: 'prelims',
    scale: 'large',
  });
  const query = lobbyListQueryOf(indexStateOf({ shown: '140' }));
  assert({
    given: 'the sample catalogue and a request for 140 shown',
    should:
      'validate the complete source and request all 140 rather than silently stopping at 100',
    actual: [
      lobbyListPageSchema.safeParse(page).success,
      query.pageSize,
      lobbyListQuerySchema.safeParse(query).success,
    ],
    expected: [true, 140, true],
  });
});
