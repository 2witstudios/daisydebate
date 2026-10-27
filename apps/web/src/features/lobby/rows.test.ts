import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomListEntry } from '@daisy/protocol';
import { lobbyRow, lobbySections } from './rows';
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
  ...over,
});

describe('lobbyRow', () => {
  test('an assembling Room offers a seat', () => {
    assert({
      given: 'an assembling casual Room the viewer is not in',
      should:
        'read Open with its format, seats and wait, Join as the primary action, and no host rating',
      actual: lobbyRow(now, entry()),
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
        action: { verb: 'Join', href: `/rooms/${id('a')}`, primary: true },
      },
    });
  });

  test('one verb per state', () => {
    const round = { id: id('c'), status: 'active' } as const;
    assert({
      given:
        'a ready Room, a started Round, and each of those with the viewer seated',
      should:
        'offer Spectate, Watch, then Return to room to the page that holds them',
      actual: [
        lobbyRow(now, entry({ status: 'ready' })).action,
        lobbyRow(now, entry({ status: 'started', roundRef: round })).action,
        lobbyRow(now, entry({ status: 'ready', seated: true })).action,
        lobbyRow(
          now,
          entry({ status: 'started', roundRef: round, seated: true }),
        ).action,
      ],
      expected: [
        { verb: 'Spectate', href: `/rooms/${id('a')}`, primary: false },
        { verb: 'Watch', href: `/rounds/${id('c')}`, primary: false },
        { verb: 'Return to room', href: `/rooms/${id('a')}`, primary: true },
        {
          verb: 'Return to room',
          href: `/rounds/${id('c')}/room`,
          primary: true,
        },
      ],
    });
  });

  test('reads the mode as a label', () => {
    const row = lobbyRow(
      now,
      entry({ competitionType: 'ranked', hostLabel: null }),
    );
    assert({
      given: 'a ranked Room whose host may not be named',
      should: 'label it Ranked and leave the host out',
      actual: [row.mode, row.host],
      expected: ['Ranked', null],
    });
  });
});

describe('lobbyRow facts', () => {
  test('each state says what matters', () => {
    const facts = (over: Partial<RoomListEntry>) =>
      lobbyRow(now, entry(over)).facts;
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
      actual: lobbySections(now, rooms).map((section) => [
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
      actual: lobbySections(now, [rooms[0]!]).map((section) => section.id),
      expected: ['live'],
    });
  });
});

test('a Room that strikes its resolution names how it is chosen (PR #472 review)', () => {
  assert({
    given: 'a listed Room whose resolution is drawn and struck',
    should: 'say the resolution is chosen by strike before the round',
    actual: lobbyRow(now, entry({ topic: null })).topic,
    expected: 'Resolution: chosen by strike before the round',
  });
});
