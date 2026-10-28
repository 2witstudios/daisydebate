import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { friendsPrivacyAdopter } from './privacy';
setupRitewayBun();

const actorId = 'a'.repeat(24),
  subject = { actorId, userId: 'u'.repeat(24) };

test('Friends erases and exports only its own tables, after Messaging', async () => {
  const erased = fakeSql([[], []]);
  await friendsPrivacyAdopter.erase(
    drizzle({ client: erased.client }),
    subject,
    {
      now: '2026-10-09T18:00:00.000Z',
    },
  );
  const exported = fakeSql([[{ state: 'accepted' }], []]);
  const result = await friendsPrivacyAdopter.export(
    drizzle({ client: exported.client }),
    subject,
  );
  assert({
    given: 'an erased subject, then an exporting one',
    should:
      'delete their challenges then friendships after the before-auth phase, and export both tables',
    actual: [
      friendsPrivacyAdopter.phase,
      erased.queries.map(
        (query) => query.query.match(/delete from ([a-z_]+)/)?.[1],
      ),
      Object.keys(result),
    ],
    expected: [
      'after-scrub',
      ['friend_challenges', 'friendships'],
      ['friendships', 'friend_challenges'],
    ],
  });
});
