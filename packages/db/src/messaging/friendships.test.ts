import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import {
  listMessagingFriendChallenges,
  listMessagingFriendships,
  readPresenceHidden,
  writePresenceHidden,
} from './friendships';
setupRitewayBun();

const me = 'a'.repeat(24),
  them = 'b'.repeat(24),
  userId = 'u'.repeat(24);
const account = {
  actorId: me,
  userId,
  member: true,
  betaState: 'approved',
  betaRevision: 1,
  ageBand: 'adult',
  erased: false,
  revision: 2,
};

test('listMessagingFriendships authorizes the locked reader first', async () => {
  const { client, queries } = fakeSql([
    [account],
    [[them, 'ada', true, 'accepted', me, new Date('2026-10-26T18:00:00.000Z')]],
  ]);
  const fenced: unknown[] = [];
  assert({
    given: 'one accepted friendship and an allowing fence',
    should:
      'name the counterpart with an ISO request time and whether they hide their status',
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
        otherHidden: true,
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

test('listMessagingFriendChallenges reads only open rooms from unblocked friends', async () => {
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
  const rows = await listMessagingFriendChallenges(
    drizzle({ client }),
    { userId, actorId: me },
    async () => {},
  );
  const read = queries.at(-1)?.query ?? '';
  assert({
    given: 'one waiting challenge',
    should:
      'name the challenger and room, and filter on room status, accepted friendship and no block',
    actual: [
      rows,
      read.includes("r.status in ('assembling', 'ready')"),
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

test('presence visibility reads and writes only behind the reader’s fence', async () => {
  const { client, queries } = fakeSql([[account], [[true]], [account], []]);
  const fenced: string[] = [];
  const fence = async () => {
    fenced.push('fenced');
  };
  const hidden = await readPresenceHidden(
    drizzle({ client }),
    { userId, actorId: me },
    fence,
  );
  const written = await writePresenceHidden(
    drizzle({ client }),
    { userId, actorId: me },
    { hidden: false, now: '2026-10-26T18:00:00.000Z' },
    fence,
  );
  assert({
    given: 'a stored hidden choice, then a choice to show',
    should: 'read it and upsert the new one, each after the fence',
    actual: [
      hidden,
      written,
      fenced,
      queries.at(-1)?.query.includes('on conflict'),
    ],
    expected: [true, false, ['fenced', 'fenced'], true],
  });
});

test('a member with no stored choice is visible', async () => {
  const { client } = fakeSql([[account], []]);
  assert({
    given: 'no presence settings row',
    should: 'read the member as not hidden',
    actual: await readPresenceHidden(
      drizzle({ client }),
      { userId, actorId: me },
      async () => {},
    ),
    expected: false,
  });
  await assertRejects({
    given: 'a malformed actor id',
    should: 'refuse the write before any query',
    actual: () =>
      writePresenceHidden(
        drizzle({ client }),
        { userId, actorId: 'x' },
        { hidden: true, now: '2026-10-26T18:00:00.000Z' },
        async () => {},
      ),
    code: 'VALIDATION',
  });
});
