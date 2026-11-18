import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomListEntry } from '@daisy/protocol';
import { lobbyRow, lobbySections, type LobbyAction } from './rows';
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
  ladder: null,
  openJudgeSeats: 0,
  ...over,
});

/** Where a row's action leads; a locked seat leads nowhere. */
const hrefOf = (action: LobbyAction): string | null =>
  action.kind === 'link' ? action.href : null;

describe('lobbyRow', () => {
  test('an assembling Room offers a seat', () => {
    assert({
      given: 'an assembling casual Room the viewer is not in',
      should:
        'read Open with its format, seats and wait, Join as the primary action, and no host rating',
      actual: lobbyRow(now, entry(), null),
      expected: {
        id: id('a'),
        title: 'Friday warm-up',
        topic: 'Cities should ban private cars',
        host: 'Maya',
        mode: 'Casual',
        ladder: null,
        format: 'Foundation',
        facts: ['1 of 3 seats', 'Waiting 7 min'],
        state: 'open',
        status: 'Open',
        action: {
          kind: 'link',
          verb: 'Join',
          href: `/rooms/${id('a')}`,
          primary: true,
        },
        note: null,
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
        lobbyRow(now, entry({ status: 'ready' }), null).action,
        lobbyRow(now, entry({ status: 'started', roundRef: round }), null)
          .action,
        lobbyRow(now, entry({ status: 'ready', seated: true }), null).action,
        lobbyRow(
          now,
          entry({ status: 'started', roundRef: round, seated: true }),
          null,
        ).action,
      ],
      expected: [
        {
          kind: 'link',
          verb: 'Spectate',
          href: `/rooms/${id('a')}`,
          primary: false,
        },
        {
          kind: 'link',
          verb: 'Watch',
          href: `/watch/${id('c')}`,
          primary: false,
        },
        {
          kind: 'link',
          verb: 'Return to room',
          href: `/rooms/${id('a')}`,
          primary: true,
        },
        {
          kind: 'link',
          verb: 'Return to room',
          href: `/rounds/${id('c')}/room`,
          primary: true,
        },
      ],
    });
  });

  test('a live Round that is not public keeps its own page', () => {
    const round = { id: id('c'), status: 'active' } as const;
    const watching = (visibility: 'unlisted' | 'private') =>
      hrefOf(
        lobbyRow(
          now,
          entry({ status: 'started', roundRef: round, visibility }),
          null,
        ).action,
      );
    assert({
      given: 'the seatless host of an unlisted and of a private Round',
      should:
        'send them where they are let in, not to a public page that refuses',
      actual: [watching('unlisted'), watching('private')],
      expected: [`/rounds/${id('c')}`, `/rounds/${id('c')}`],
    });
    assert({
      given: 'a started Room whose Round the listing did not carry',
      should: 'lead to the live listing, never to the Room',
      actual: hrefOf(lobbyRow(now, entry({ status: 'started' }), null).action),
      expected: '/watch',
    });
  });

  test('reads the mode as a label', () => {
    const row = lobbyRow(
      now,
      entry({ competitionType: 'ranked', hostLabel: null }),
      null,
    );
    assert({
      given: 'a ranked Room whose host may not be named',
      should: 'label it Ranked and leave the host out',
      actual: [row.mode, row.host],
      expected: ['Ranked', null],
    });
  });
});

describe('lobbyRow ladders', () => {
  const ranked = (over: Partial<RoomListEntry> = {}) =>
    entry({ competitionType: 'ranked', ...over });

  test('a ranked row carries its ladder; a casual row none', () => {
    assert({
      given:
        'a Youth, an Open, an unset and a mixed ranked Room, and a casual one',
      should: 'carry each ranked ladder and none for casual',
      actual: [
        lobbyRow(now, ranked({ ladder: 'youth' }), 'youth').ladder,
        lobbyRow(now, ranked({ ladder: 'open' }), 'open').ladder,
        lobbyRow(now, ranked({ ladder: 'unset' }), 'youth').ladder,
        lobbyRow(now, ranked({ ladder: 'mixed' }), 'youth').ladder,
        lobbyRow(now, entry(), 'youth').ladder,
      ],
      expected: ['youth', 'open', 'unset', 'mixed', null],
    });
  });

  test('a Room no debater has sat in', () => {
    const row = lobbyRow(now, ranked({ ladder: 'unset' }), 'open');
    assert({
      given: 'an open ranked Room whose ladder no debater has set',
      should: 'offer Join and say the first debater sets the ladder',
      actual: [row.action.kind === 'link' && row.action.verb, row.note],
      expected: [
        'Join',
        'The first debater to sit sets the ladder: Youth or Open.',
      ],
    });
  });

  test('debater seats on the viewer’s other ladder', () => {
    const youthViewingOpen = lobbyRow(now, ranked({ ladder: 'open' }), 'youth');
    const adultViewingYouth = lobbyRow(
      now,
      ranked({ ladder: 'youth' }),
      'open',
    );
    assert({
      given: 'a youth member on an Open row and an adult on a Youth row',
      should: 'lock the seat with who it is for, and say so under the facts',
      actual: [
        youthViewingOpen.action,
        youthViewingOpen.note,
        adultViewingYouth.action,
        adultViewingYouth.note,
      ],
      expected: [
        { kind: 'locked', label: '18 and over' },
        'Debater seats: 18 and over.',
        { kind: 'locked', label: 'Under 18' },
        'Debater seats: under 18. You can still judge.',
      ],
    });
  });

  test('a free judge seat is open to everyone', () => {
    const row = lobbyRow(
      now,
      ranked({ ladder: 'open', openJudgeSeats: 1 }),
      'youth',
    );
    assert({
      given: 'an Open row with a free judge seat, seen by a youth member',
      should: 'offer Judge on the Room and say the judge seat is everyone’s',
      actual: [row.action, row.note],
      expected: [
        {
          kind: 'link',
          verb: 'Judge',
          href: `/rooms/${id('a')}`,
          primary: false,
        },
        'Judge seat open to everyone.',
      ],
    });
  });

  test('the viewer’s own ladder, no ladder, a seat already held, a live Round', () => {
    const verb = (row: ReturnType<typeof lobbyRow>) =>
      row.action.kind === 'link' ? row.action.verb : row.action.label;
    assert({
      given:
        'a Youth row seen by a youth member, by a member with no ladder, by an adult already seated, and a live Youth Round seen by an adult',
      should: 'keep the usual verb with no seat line',
      actual: [
        lobbyRow(now, ranked({ ladder: 'youth' }), 'youth'),
        lobbyRow(now, ranked({ ladder: 'youth' }), null),
        lobbyRow(now, ranked({ ladder: 'youth', seated: true }), 'open'),
        lobbyRow(
          now,
          ranked({
            ladder: 'youth',
            status: 'started',
            waitingSince: null,
            roundRef: { id: id('c'), status: 'active' },
          }),
          'open',
        ),
      ].map((row) => [verb(row), row.note]),
      expected: [
        ['Join', null],
        ['Join', null],
        ['Return to room', null],
        ['Watch', null],
      ],
    });
  });
});

describe('lobbyRow facts', () => {
  test('each state says what matters', () => {
    const facts = (over: Partial<RoomListEntry>) =>
      lobbyRow(now, entry(over), null).facts;
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
      actual: lobbySections(now, rooms, null).map((section) => [
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
      actual: lobbySections(now, [rooms[0]!], null).map(
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
    actual: lobbyRow(now, entry({ topic: null }), null).topic,
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
      null,
    ).facts,
    expected: ['Judging'],
  });
});
