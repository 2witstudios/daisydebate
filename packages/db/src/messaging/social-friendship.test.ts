import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { contactBlockWriter } from './social-block';
import { friendshipFrame } from './social-friendship';
setupRitewayBun();

const low = 'a'.repeat(24),
  high = 'b'.repeat(24),
  userId = 'u'.repeat(24),
  requestId = 'r'.repeat(24);
const pair = {
  lowActorId: low,
  highActorId: high,
  lowBlocksHigh: false,
  highBlocksLow: false,
  revision: 3,
};
const input = { actorId: high, userId, memberActorIds: [low, high] };
const now = '2026-10-26T18:00:00.000Z';

test('readFriendship reads the locked pair and both members’ counts', async () => {
  const { client, queries } = fakeSql([
    [['pending', low]],
    [[0]],
    [[4]],
    [[9]],
  ]);
  const frame = friendshipFrame(
    drizzle({ client }),
    input,
    [pair],
    async () => {},
  );
  assert({
    given: 'a pending request from the low member',
    should: 'report the counterpart, the pair and the counts',
    actual: await frame.readFriendship(),
    expected: {
      otherActorId: low,
      pair: { state: 'pending', requesterActorId: low },
      actorPendingOutgoing: 0,
      actorFriends: 4,
      otherFriends: 9,
    },
  });
  assert({
    given: 'the pair read',
    should: 'lock the friendship row',
    actual: queries[0]?.query.includes('for update'),
    expected: true,
  });
});

test('commitFriendship reauthorizes and writes the next pair', async () => {
  const { client, queries } = fakeSql([[], [], [], []]);
  let fences = 0;
  const frame = friendshipFrame(
    drizzle({ client }),
    input,
    [pair],
    async () => {
      fences += 1;
    },
  );
  await frame.commitFriendship({
    previous: null,
    next: { state: 'pending', requesterActorId: high },
    now,
  });
  await frame.commitFriendship({
    previous: { state: 'pending', requesterActorId: low },
    next: { state: 'accepted', requesterActorId: low },
    now,
  });
  await frame.commitFriendship({
    previous: { state: 'accepted', requesterActorId: low },
    next: null,
    now,
  });
  assert({
    given: 'an insert, an acceptance and a removal',
    should:
      'fence each write, issue insert, update and delete, and end the pair’s challenges with the friendship',
    actual: [
      fences,
      queries.map((query) => query.query.split(' ')[0]),
      queries[0]?.params.includes(high),
      queries[1]?.params.includes('accepted'),
      queries[3]?.query.includes('"messaging_friend_challenges"'),
    ],
    expected: [3, ['insert', 'update', 'delete', 'delete'], true, true, true],
  });
});

test('a fresh block deletes the pair’s friendship; an unblock does not touch it', async () => {
  const run = async (blocked: boolean) => {
    const { client, queries } = fakeSql([
      [[low, high, false, blocked, 4]],
      [],
      [],
      [],
    ]);
    await contactBlockWriter(
      drizzle({ client }),
      input,
      [pair],
      async () => {},
    )({ requestId, blocked, digest: 'd'.repeat(64), now });
    return queries.some(
      (query) =>
        query.query.startsWith('delete') &&
        query.query.includes('"messaging_friendships"'),
    );
  };
  assert({
    given: 'a block and then an unblock',
    should: 'delete the friendship only on the block',
    actual: [await run(true), await run(false)],
    expected: [true, false],
  });
});
