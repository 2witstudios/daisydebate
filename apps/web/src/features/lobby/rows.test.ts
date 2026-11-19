import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomListEntry } from '@daisy/protocol';
import { lobbyRow, lobbySections, rowActions, type LobbyViewer } from './rows';
setupRitewayBun();

const id = (c: string) => c.repeat(24);
const now = Date.parse('2026-10-26T12:00:00.000Z');
const entry = (over: Partial<RoomListEntry> = {}): RoomListEntry => ({
  id: id('a'),
  version: 1,
  title: 'Friday warm-up',
  topic: 'Cities should ban private cars',
  visibility: 'public',
  hostActorId: id('b'),
  hostLabel: 'Maya',
  status: 'assembling',
  competitionType: 'casual',
  seated: false,
  roundRef: null,
  formatLabel: 'Foundation',
  seatsTaken: 1,
  seatCount: 3,
  waitingSince: '2026-10-26T11:53:00.000Z',
  live: null,
  hostRating: 1640,
  division: 'open',
  openJudgeSeats: 0,
  ...over,
});

const adult: LobbyViewer = { actorId: id('d'), division: 'open' };
const minor: LobbyViewer = { actorId: id('e'), division: 'youth' };
const round = { id: id('c'), status: 'active' } as const;
const live = (over: Partial<RoomListEntry> = {}) =>
  entry({
    status: 'started',
    roundRef: round,
    waitingSince: null,
    live: { stage: 'live', startedAt: '2026-10-26T11:50:00.000Z' },
    ...over,
  });
const room = `/rooms/${id('a')}`;
const watch = (href = room) =>
  ({ verb: 'Watch', href, primary: false }) as const;

describe('lobbyRow', () => {
  test('an assembling Room in the viewer’s own lobby', () => {
    assert({
      given: 'an assembling casual Room the viewer is not in',
      should:
        'read Open with its format, seats and wait, Watch beside Join, and no division',
      actual: lobbyRow(now, entry(), adult),
      expected: {
        id: id('a'),
        title: 'Friday warm-up',
        topic: 'Cities should ban private cars',
        host: 'Maya',
        mode: 'Casual',
        format: 'Foundation',
        facts: ['1 of 3 seats', 'Waiting 7 min'],
        state: 'open',
        status: 'Open',
        actions: [
          watch(),
          { verb: 'Join', href: room, primary: true } as const,
        ],
      },
    });
  });

  test('reads the mode as a label', () => {
    assert({
      given: 'a ranked Room and a casual one',
      should: 'read Ranked and Casual',
      actual: [
        lobbyRow(now, entry({ competitionType: 'ranked' }), adult).mode,
        lobbyRow(now, entry(), adult).mode,
      ],
      expected: ['Ranked', 'Casual'],
    });
  });
});

describe('rowActions', () => {
  test('Watch on every row beside its action (YLRowMatrix)', () => {
    assert({
      given: 'an open Room, a starting Room and a live Open Round',
      should:
        'offer Watch beside Join, Watch alone while starting, and Watch on the live page',
      actual: [
        rowActions(adult, entry(), 'open'),
        rowActions(adult, entry({ status: 'ready' }), 'starting'),
        rowActions(adult, live(), 'live'),
      ],
      expected: [
        [watch(), { verb: 'Join', href: room, primary: true }],
        [watch()],
        [watch(`/watch/${id('c')}`)],
      ],
    });
  });

  test('a seat the viewer holds', () => {
    assert({
      given: 'a seated viewer before and during the Round',
      should: 'offer only Return to room, to the page that holds them',
      actual: [
        rowActions(adult, entry({ seated: true }), 'open'),
        rowActions(adult, live({ seated: true }), 'live'),
      ],
      expected: [
        [{ verb: 'Return to room', href: room, primary: true }],
        [
          {
            verb: 'Return to room',
            href: `/rounds/${id('c')}/room`,
            primary: true,
          },
        ],
      ],
    });
  });

  test('a Room of the other lobby', () => {
    const youthRanked = entry({ division: 'youth', competitionType: 'ranked' });
    assert({
      given:
        'an adult browsing Youth: a ranked Room with a judge seat free, one without, a casual one',
      should: 'offer Watch beside Judge, then Watch alone, never Join',
      actual: [
        rowActions(adult, { ...youthRanked, openJudgeSeats: 1 }, 'open'),
        rowActions(adult, youthRanked, 'open'),
        rowActions(adult, entry({ division: 'youth' }), 'open'),
      ],
      expected: [
        [watch(), { verb: 'Judge', href: room, primary: false }],
        [watch()],
        [watch()],
      ],
    });
    assert({
      given: 'a minor browsing Open with a judge seat free',
      should: 'offer Watch beside Judge',
      actual: rowActions(minor, entry({ openJudgeSeats: 1 }), 'open'),
      expected: [watch(), { verb: 'Judge', href: room, primary: false }],
    });
  });

  test('a member with no age record', () => {
    const unknown: LobbyViewer = { actorId: id('f'), division: null };
    assert({
      given: 'an Open casual Room and an Open ranked Room',
      should: 'offer Join only in the casual one',
      actual: [
        rowActions(unknown, entry(), 'open').map((a) => a.verb),
        rowActions(unknown, entry({ competitionType: 'ranked' }), 'open').map(
          (a) => a.verb,
        ),
      ],
      expected: [['Watch', 'Join'], ['Watch']],
    });
  });

  test('a live Youth Round is watched as an Open one is (ADR 0159)', () => {
    const youthLive = (over: Partial<RoomListEntry> = {}) =>
      live({ division: 'youth', ...over });
    const openLive = (over: Partial<RoomListEntry> = {}) =>
      live({ division: 'open', ...over });
    assert({
      given:
        'a public and an unlisted live Round in each lobby, read by an outsider',
      should: 'offer the same Watch in both lobbies',
      actual: [
        rowActions(minor, youthLive(), 'live'),
        rowActions(minor, youthLive({ visibility: 'unlisted' }), 'live'),
      ],
      expected: [
        rowActions(minor, openLive(), 'live'),
        rowActions(minor, openLive({ visibility: 'unlisted' }), 'live'),
      ],
    });
    assert({
      given:
        "an unlisted live Youth Round read by a debater's linked coach, and the public one",
      should:
        "send the coach through to the Round's live room, and to the public page like anyone",
      actual: [
        rowActions(
          { ...adult, studentRoundIds: [id('c')] },
          youthLive({ visibility: 'unlisted' }),
          'live',
        ),
        rowActions(
          { ...adult, studentRoundIds: [id('c')] },
          youthLive(),
          'live',
        ),
      ],
      expected: [
        [watch(`/rounds/${id('c')}/room`)],
        rowActions(adult, youthLive(), 'live'),
      ],
    });
  });

  test('a live Round that is not public keeps its own page', () => {
    const hrefOf = (over: Partial<RoomListEntry>) =>
      rowActions(adult, live(over), 'live')[0]?.href;
    assert({
      given: 'the seatless host of an unlisted and of a private Round',
      should:
        'send them where they are let in, not to a public page that refuses',
      actual: [
        hrefOf({ visibility: 'unlisted' }),
        hrefOf({ visibility: 'private' }),
      ],
      expected: [`/rounds/${id('c')}`, `/rounds/${id('c')}`],
    });
    assert({
      given: 'a started Room whose Round the listing did not carry',
      should: 'lead to the live listing, never to the Room',
      actual: hrefOf({ roundRef: null }),
      expected: '/watch',
    });
  });
});

describe('lobbyRow facts', () => {
  test('each state says what matters', () => {
    const facts = (over: Partial<RoomListEntry>) =>
      lobbyRow(now, entry(over), adult).facts;
    assert({
      given:
        'a Room just opened, one waiting two hours, a ready Room, and a live Round in prep',
      should:
        'name the seats and the wait while open, the seats when starting, and the stage when live',
      actual: [
        facts({ waitingSince: '2026-10-26T11:59:40.000Z' }),
        facts({ waitingSince: '2026-10-26T10:00:00.000Z', seatsTaken: 2 }),
        facts({ status: 'ready', seatsTaken: 3, waitingSince: null }),
        facts({
          status: 'started',
          waitingSince: null,
          live: { stage: 'prep', startedAt: '2026-10-26T11:50:00.000Z' },
        }),
      ],
      expected: [
        ['1 of 3 seats', 'Just opened'],
        ['2 of 3 seats', 'Waiting 2 h'],
        ['3 of 3 seats'],
        ['Prep'],
      ],
    });
  });
});

describe('lobbySections', () => {
  const rooms = [
    entry({ id: id('a'), status: 'started', competitionType: 'ranked' }),
    entry({ id: id('b') }),
    entry({ id: id('c'), status: 'ready' }),
    entry({ id: id('d'), competitionType: 'ranked' }),
  ];

  test('groups the returned page open, starting then live, in listing order', () => {
    assert({
      given: 'a page mixing every status, already narrowed by the listing',
      should:
        'show Open first, then Starting, then Live, and narrow nothing itself',
      actual: lobbySections(now, rooms, adult).map((section) => [
        section.id,
        section.rows.map((row) => row.id[0]),
      ]),
      expected: [
        ['open', ['b', 'd']],
        ['starting', ['c']],
        ['live', ['a']],
      ],
    });
  });

  test('drops empty sections', () => {
    assert({
      given: 'a page of live Rooms only',
      should: 'show only the Live section',
      actual: lobbySections(now, [rooms[0]!], adult).map(
        (section) => section.id,
      ),
      expected: ['live'],
    });
  });
});

test('a Room that strikes its resolution names how it is chosen (PR #472 review)', () => {
  assert({
    given: 'a listed Room whose resolution is drawn and struck',
    should: 'say the resolution is chosen by strike before the round',
    actual: lobbyRow(now, entry({ topic: null }), adult).topic,
    expected: 'Resolution: chosen by strike before the round',
  });
});

test('a Room whose debate has ended reads as judging', () => {
  assert({
    given: 'a live Room whose Round awaits its ballot',
    should: 'name the stage in the row',
    actual: lobbyRow(
      now,
      entry({
        status: 'started',
        waitingSince: null,
        live: {
          stage: 'awaiting_ballot',
          startedAt: '2026-10-26T11:50:00.000Z',
        },
      }),
      adult,
    ).facts,
    expected: ['Judging'],
  });
});
