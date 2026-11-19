import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { leaderboardTagline } from './leaderboard-tagline';

setupRitewayBun();

describe('leaderboardTagline', () => {
  test('every ladder by name, the member’s own first', () => {
    assert({
      given: 'a youth member, an adult, and a visitor',
      should: 'lead with their own ladder, Youth for a visitor',
      actual: [
        leaderboardTagline('youth'),
        leaderboardTagline('open'),
        leaderboardTagline(null),
      ],
      expected: [
        'Youth – Freestyle and Open – Freestyle ladders.',
        'Open – Freestyle and Youth – Freestyle ladders.',
        'Youth – Freestyle and Open – Freestyle ladders.',
      ],
    });
  });
});
