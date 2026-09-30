import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { filterRooms, tabCounts } from './filter';
import { defaultQuery } from './query';
import { liveRoom, openRoom } from './room.test-support';

setupRitewayBun();

const viewer = { rating: 1400 };
const rooms = [
  openRoom({
    id: 'a',
    name: 'Tuesday night',
    host: { handle: 'host-one', rating: 1512 },
  }),
  openRoom({
    id: 'b',
    name: 'Newcomers welcome',
    mode: 'casual',
    host: { handle: 'host-two', rating: 1180 },
  }),
  liveRoom({
    id: 'c',
    name: 'Ranked serious',
    host: { handle: 'debater-a', rating: 1620 },
    opponent: { handle: 'debater-b', rating: 1588 },
  }),
  liveRoom({
    id: 'd',
    name: 'Friendly spar',
    mode: 'casual',
    host: { handle: 'debater-e', rating: 1260 },
    opponent: { handle: 'debater-f', rating: 1240 },
  }),
];
const ids = (list: readonly { readonly id: string }[]) =>
  list.map((room) => room.id);
const run = (over: Partial<typeof defaultQuery>) =>
  ids(filterRooms(rooms, { ...defaultQuery, ...over }, viewer));

describe('filterRooms', () => {
  test('the default query', () => {
    assert({
      given: 'the default query',
      should: 'keep every room in order',
      actual: run({}),
      expected: ['a', 'b', 'c', 'd'],
    });
  });

  test('tab', () => {
    assert({
      given: 'the open and live tabs',
      should: 'keep only that status',
      actual: [run({ tab: 'open' }), run({ tab: 'live' })],
      expected: [
        ['a', 'b'],
        ['c', 'd'],
      ],
    });
  });

  test('mode', () => {
    assert({
      given: 'ranked and casual modes',
      should: 'keep only that mode',
      actual: [run({ mode: 'ranked' }), run({ mode: 'casual' })],
      expected: [
        ['a', 'c'],
        ['b', 'd'],
      ],
    });
  });

  test('rating range', () => {
    assert({
      given: 'within 100 and 200 of a 1400 viewer',
      should:
        'measure an open table by its host and a live room by its mean, edges inclusive',
      actual: [run({ range: 100 }), run({ range: 200 })],
      // a: 112 away, b: 220, c: 1604 -> 204, d: 1250 -> 150
      expected: [[], ['a', 'd']],
    });
  });

  test('range edge', () => {
    assert({
      given: 'a room exactly 100 from the viewer',
      should: 'keep it',
      actual: ids(
        filterRooms(
          [openRoom({ id: 'edge', host: { handle: 'h', rating: 1500 } })],
          { ...defaultQuery, range: 100 },
          viewer,
        ),
      ),
      expected: ['edge'],
    });
  });

  test('search', () => {
    assert({
      given: 'searches by room name, host, opponent, handle prefix and case',
      should: 'match any of them as a case-insensitive substring',
      actual: [
        run({ q: 'NEWCOMERS' }),
        run({ q: 'host-one' }),
        run({ q: 'debater-b' }),
        run({ q: '@debater-f' }),
        run({ q: 'nothing like this' }),
      ],
      expected: [['b'], ['a'], ['c'], ['d'], []],
    });
  });

  test('filters combine', () => {
    assert({
      given: 'ranked mode and the live tab',
      should: 'apply both',
      actual: run({ tab: 'live', mode: 'ranked' }),
      expected: ['c'],
    });
  });

  test('the listing is not mutated', () => {
    const before = ids(rooms);
    filterRooms(rooms, { ...defaultQuery, tab: 'live' }, viewer);
    assert({
      given: 'a filtered listing',
      should: 'leave the source list unchanged',
      actual: ids(rooms),
      expected: before,
    });
  });
});

describe('tabCounts', () => {
  test('counts by status', () => {
    assert({
      given: 'two open and two live rooms',
      should: 'count all, open and live',
      actual: tabCounts(rooms),
      expected: { all: 4, open: 2, live: 2 },
    });
  });

  test('empty', () => {
    assert({
      given: 'no rooms',
      should: 'count zeros',
      actual: tabCounts([]),
      expected: { all: 0, open: 0, live: 0 },
    });
  });
});
