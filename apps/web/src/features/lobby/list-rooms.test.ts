import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listRooms } from './list-rooms';
import { defaultQuery } from './query';
import { NOW } from './room.test-support';

setupRitewayBun();

const names = (query: Partial<typeof defaultQuery>) =>
  listRooms({ ...defaultQuery, ...query }, NOW).rooms.map((room) => room.name);

describe('listRooms', () => {
  test('the default lobby', () => {
    const listing = listRooms(defaultQuery, NOW);
    assert({
      given: 'the default query',
      should: 'list all eight rooms closest to the viewer first, with counts',
      actual: [
        listing.viewer,
        listing.counts,
        listing.rooms.map((room) => room.id),
      ],
      expected: [
        { rating: 1400 },
        { all: 8, open: 5, live: 3 },
        [
          'room-quarterfinal',
          'room-anything-goes',
          'room-tuesday-night',
          'room-friendly-spar',
          'room-ranked-serious',
          'room-newcomers',
          'room-finals-rehearsal',
          'room-top-of-ladder',
        ],
      ],
    });
  });

  test('filters and sort apply to the listing', () => {
    assert({
      given: 'the ranked live rooms sorted by most watched',
      should: 'list them by audience',
      actual: names({ tab: 'live', mode: 'ranked', sort: 'watched' }),
      expected: ['Finals rehearsal', 'Ranked, serious only'],
    });
  });

  test('counts ignore filters', () => {
    assert({
      given: 'a search that matches one room',
      should: 'still count every room in the tabs',
      actual: listRooms({ ...defaultQuery, q: 'friendly' }, NOW).counts,
      expected: { all: 8, open: 5, live: 3 },
    });
  });

  test('no match', () => {
    assert({
      given: 'a search that matches nothing',
      should: 'return no rooms',
      actual: names({ q: 'zzz' }),
      expected: [],
    });
  });
});
