import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { listMessagingFriendships } from './friendships';
setupRitewayBun();

const me = 'a'.repeat(24),
  them = 'b'.repeat(24),
  userId = 'u'.repeat(24);
const account = {
  actorId: me,
  userId,
  member: true,
  betaState: 'approved',
  betaRevision: 1, ageBand: 'adult',
  erased: false,
  revision: 2,
};

test('listMessagingFriendships authorizes the locked reader first', async () => {
  const { client, queries } = fakeSql([
    [account],
    [[them, 'ada', 'accepted', me, new Date('2026-10-26T18:00:00.000Z')]],
  ]);
  const fenced: unknown[] = [];
  assert({
    given: 'one accepted friendship and an allowing fence',
    should: 'name the counterpart with an ISO request time',
    actual: await listMessagingFriendships(
      drizzle({ client }),
      { userId, actorId: me },
      async ({ account: locked }) => {
        fenced.push(locked?.revision);
      },
    ),
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
  const read = queries.find((query) =>
    query.query.includes('"messaging_friendships"'),
  );
  assert({
    given: 'the read',
    should:
      'fence the locked account, bound the rows and skip blocked or erased counterparts',
    actual: [
      fenced,
      queries.findIndex((query) =>
        query.query.includes('daisy_authorization_accounts'),
      ) < queries.indexOf(read!),
      read?.query.includes('limit'),
      read?.query.includes('"low_blocks_high" = $'),
      read?.query.includes('"deleted_at" is null'),
    ],
    expected: [[2], true, true, true, true],
  });
});

test('a refusing fence reads nothing', async () => {
  const { client, queries } = fakeSql([[account]]);
  await assertRejects({
    given: 'a fence denying the reader',
    should: 'refuse before the friendship read',
    actual: () =>
      listMessagingFriendships(
        drizzle({ client }),
        { userId, actorId: me },
        async () => {
          throw createAppError('AUTHORIZATION');
        },
      ),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the refused read',
    should: 'never query friendships',
    actual: queries.some((query) =>
      query.query.includes('"messaging_friendships"'),
    ),
    expected: false,
  });
  await assertRejects({
    given: 'a malformed actor id',
    should: 'refuse before any query',
    actual: () =>
      listMessagingFriendships(
        drizzle({ client }),
        { userId, actorId: 'x' },
        async () => {},
      ),
    code: 'VALIDATION',
  });
});
