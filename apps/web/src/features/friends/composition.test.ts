import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  discoverySpends,
  openRecordedMember,
} from '../account/username-discovery.test-support';
import { challengeRateLimit } from './challenge-operations';
import { composeFriendRoutes } from './composition';

setupRitewayBun();

const me = 'a'.repeat(24);
const FRIEND_RULE = { windowSeconds: 60, max: 30 };

test('friend changes and challenges spend their own budget, then discovery, before any pair work', async () => {
  const stores: string[] = [];
  const member = await openRecordedMember(
    me,
    'friends-composition@daisy.example.com',
    composeFriendRoutes,
    {
      database: {
        lookupHumanActorByUsername: async () => null,
        friendStore: () => {
          stores.push('store');
          throw new Error('Unexpected friend store');
        },
      },
    },
  );
  try {
    const removed = await member.routes.remove(
      member.post('/api/friends/remove', { version: 1, username: 'ghost' }),
    );
    const afterRemove = member.spent.splice(0);
    const challenged = await member.routes.challenge(
      member.post('/api/friends/challenges', {
        version: 1,
        username: 'ghost',
        roomId: 'r'.repeat(24),
      }),
    );
    assert({
      given:
        'a removal and a challenge naming an unknown member (the existence probe)',
      should:
        'refuse each alike after its own budget and one discovery spend, reaching no pair store',
      actual: [
        removed.status,
        afterRemove,
        challenged.status,
        member.spent,
        stores,
      ],
      expected: [
        404,
        [[`friends:${me}`, FRIEND_RULE], ...discoverySpends(me)],
        404,
        [
          [challengeRateLimit.key(me), challengeRateLimit.rule],
          ...discoverySpends(me),
        ],
        [],
      ],
    });
  } finally {
    await member.close();
  }
});
