import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { listMessagingFriendships } from './friendships';
setupRitewayBun();

const me = 'a'.repeat(24),
  them = 'b'.repeat(24);

test('listMessagingFriendships', async () => {
  const { client, queries } = fakeSql([
    [[them, 'ada', 'accepted', me, new Date('2026-10-26T18:00:00.000Z')]],
  ]);
  assert({
    given: 'one accepted friendship',
    should: 'name the counterpart with an ISO request time',
    actual: await listMessagingFriendships(drizzle({ client }), me),
    expected: [
      {
        otherActorId: them,
        username: 'ada',
        state: 'accepted',
        requesterActorId: me,
        requestedAt: '2026-10-26T18:00:00.000Z',
      },
    ],
  });
  assert({
    given: 'the read',
    should: 'bound the rows and skip erased counterparts',
    actual: [
      queries[0]?.query.includes('limit'),
      queries[0]?.query.includes('"deleted_at" is null'),
    ],
    expected: [true, true],
  });
  await assertRejects({
    given: 'a malformed actor id',
    should: 'refuse before any query',
    actual: () => listMessagingFriendships(drizzle({ client }), 'x'),
    code: 'VALIDATION',
  });
});
