import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { leaderboardDestinations } from './actions';
import { everyoneHref, seasonHref } from './query';
import { defaultQuery } from './query';

setupRitewayBun();

describe('destinations', () => {
  test('links', () => {
    assert({
      given: 'the leaderboard actions',
      should: 'point at existing routes',
      actual: [
        leaderboardDestinations.findMatch,
        everyoneHref({ ...defaultQuery, q: 'abc', page: 3 }),
        seasonHref(3),
      ],
      expected: [
        '/ranked',
        '/leaderboard?q=abc&status=everyone',
        '/leaderboard?season=3',
      ],
    });
  });
});
