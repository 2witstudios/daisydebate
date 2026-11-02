import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  discoverySpends,
  openRecordedMember,
} from '../account/username-discovery.test-support';
import { composeFriendRoutes } from './composition';

setupRitewayBun();

const me = 'a'.repeat(24);
const FRIEND_RULE = { windowSeconds: 60, max: 30 };

test('friend changes spend their own budget, then discovery, before any pair', async () => {
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
    assert({
      given: 'a removal naming an unknown member (the existence probe)',
      should: 'refuse after its own budget and one discovery spend, reaching no pair',
      actual: [removed.status, member.spent, stores],
      expected: [
        404,
        [[`friends:${me}`, FRIEND_RULE], ...discoverySpends(me)],
        [],
      ],
    });
  } finally {
    await member.close();
  }
});
