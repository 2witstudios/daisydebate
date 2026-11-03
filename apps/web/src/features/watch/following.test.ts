import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { followingOf } from './following';

setupRitewayBun();

describe('followingOf', () => {
  test('real follows and history, as the tab shows them', () => {
    assert({
      given: 'one followed debater live, one not, and two Rounds watched',
      should:
        'name the live Round, leave the other without one, and hold back an unreleased resolution',
      actual: followingOf({
        usernames: ['ana', 'lin'],
        live: new Map([['ana', { id: 'round', title: 'Semifinal' }]]),
        history: [
          {
            roundId: 'seen',
            resolution: 'Resolved: x',
            watchedAt: '2026-11-02T10:00:00.000Z',
          },
          {
            roundId: 'held',
            resolution: null,
            watchedAt: '2026-11-01T10:00:00.000Z',
          },
        ],
      }),
      expected: {
        people: [
          { handle: 'ana', live: { id: 'round', title: 'Semifinal' } },
          { handle: 'lin', live: null },
        ],
        history: [
          { id: 'seen', title: 'Resolved: x', watchedOn: '2026-11-02' },
          { id: 'held', title: 'A Round on air', watchedOn: '2026-11-01' },
        ],
      },
    });
  });
});
