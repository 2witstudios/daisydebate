import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { listFriendChallenges, listFriendships } from './reads';
import { ownReader } from '../own-collection.test-support';
setupRitewayBun();

const me = 'a'.repeat(24),
  them = 'b'.repeat(24),
  userId = 'u'.repeat(24);
const account = ownReader(me, userId);

test('listFriendships authorizes the locked reader first', async () => {
  const { client, queries } = fakeSql([
    [account],
    [[them, 'ada', true, 'accepted', me, new Date('2026-10-26T18:00:00.000Z')]],
  ]);
  const fenced: unknown[] = [];
  assert({
    given: 'one accepted friendship and an allowing fence',
    should:
      'name the counterpart with an ISO request time and whether they hide their status',
    actual: await listFriendships(
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
        otherHidden: true,
      },
    ],
  });
  const read = queries.find((query) => query.query.includes('"friendships"'));
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
      listFriendships(
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
    actual: queries.some((query) => query.query.includes('"friendships"')),
    expected: false,
  });
  await assertRejects({
    given: 'a malformed actor id',
    should: 'refuse before any query',
    actual: () =>
      listFriendships(
        drizzle({ client }),
        { userId, actorId: 'x' },
        async () => {},
      ),
    code: 'VALIDATION',
  });
});

test('listFriendChallenges reads only open rooms from unblocked friends', async () => {
  const { client, queries } = fakeSql([
    [account],
    [
      {
        roomId: 'r'.repeat(24),
        username: 'ada',
        title: 'Ada vs me',
        challengedAt: new Date('2026-10-26T18:00:00.000Z'),
      },
    ],
  ]);
  const rows = await listFriendChallenges(
    drizzle({ client }),
    { userId, actorId: me },
    async () => {},
  );
  const read = queries.at(-1)?.query ?? '';
  assert({
    given: 'one waiting challenge',
    should:
      'name the challenger and room, and filter on the Rooms open predicate (S7), accepted friendship and no block',
    actual: [
      rows,
      read.includes('"rooms"."status" in') &&
        ['assembling', 'ready'].every((status) =>
          queries.at(-1)?.params.includes(status),
        ),
      read.includes("f.state = 'accepted'"),
      read.includes('not p.low_blocks_high'),
    ],
    expected: [
      [
        {
          roomId: 'r'.repeat(24),
          username: 'ada',
          title: 'Ada vs me',
          challengedAt: '2026-10-26T18:00:00.000Z',
        },
      ],
      true,
      true,
      true,
    ],
  });
});
