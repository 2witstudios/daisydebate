import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { leaderboardDestinations, signInToSeeRankHref } from './actions';
import { everyoneHref, seasonHref } from './query';
import { defaultQuery } from './query';

setupRitewayBun();

describe('destinations', () => {
  test('links', () => {
    assert({
      given: 'the leaderboard actions',
      should: 'point at existing routes and return to the ladder after sign-in',
      actual: [
        leaderboardDestinations.findMatch,
        signInToSeeRankHref('/leaderboard?season=3'),
        everyoneHref({ ...defaultQuery, q: 'abc', page: 3 }),
        seasonHref(3),
      ],
      expected: [
        '/ranked',
        '/sign-in?next=%2Fleaderboard%3Fseason%3D3',
        '/leaderboard?q=abc&status=everyone',
        '/leaderboard?season=3',
      ],
    });
  });
});
