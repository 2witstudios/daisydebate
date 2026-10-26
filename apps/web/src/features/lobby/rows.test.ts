import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomListEntry } from '@daisy/protocol';
import { defaultLobbyFilters } from './discovery-query';
import { lobbyRow, lobbySections } from './rows';
setupRitewayBun();

const id = (c: string) => c.repeat(24);
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
  ...over,
});

describe('lobbyRow', () => {
  test('an assembling Room offers a seat', () => {
    assert({
      given: 'an assembling casual Room the viewer is not in',
      should: 'read Open with Join to the Room as the primary action',
      actual: lobbyRow(entry()),
      expected: {
        id: id('a'),
        title: 'Friday warm-up',
        topic: 'Cities should ban private cars',
        host: 'Maya',
        mode: 'Casual',
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
        lobbyRow(entry({ status: 'ready' })).action,
        lobbyRow(entry({ status: 'started', roundRef: round })).action,
        lobbyRow(entry({ status: 'ready', seated: true })).action,
        lobbyRow(entry({ status: 'started', roundRef: round, seated: true }))
          .action,
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
    const row = lobbyRow(entry({ competitionType: 'ranked', hostLabel: null }));
    assert({
      given: 'a ranked Room whose host may not be named',
      should: 'label it Ranked and leave the host out',
      actual: [row.mode, row.host],
      expected: ['Ranked', null],
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
  const ids = (sections: ReturnType<typeof lobbySections>) =>
    sections.map((section) => [
      section.id,
      section.rows.map((row) => row.id[0]),
    ]);

  test('groups open, starting then live, keeping the listing order', () => {
    assert({
      given: 'a page mixing every status',
      should: 'show Open first, then Starting, then Live',
      actual: ids(lobbySections(rooms, defaultLobbyFilters)),
      expected: [
        ['open', ['b', 'd']],
        ['starting', ['c']],
        ['live', ['a']],
      ],
    });
  });

  test('narrows by status and mode and drops empty sections', () => {
    assert({
      given: 'the open tab, ranked, then the live tab with casual',
      should: 'keep only the matching rows in non-empty sections',
      actual: [
        ids(lobbySections(rooms, { ...defaultLobbyFilters, status: 'open' })),
        ids(lobbySections(rooms, { ...defaultLobbyFilters, mode: 'ranked' })),
        ids(lobbySections(rooms, { status: 'live', mode: 'casual' })),
      ],
      expected: [
        [['open', ['b', 'd']]],
        [
          ['open', ['d']],
          ['live', ['a']],
        ],
        [],
      ],
    });
  });
});
