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

const limits = {
  daily: 20,
  unrelatedHourly: 5,
  declinesToBlock: 3,
  declineBlockMs: 2_592_000_000,
};
const tables = (queries: readonly { query: string }[]) =>
  queries.map(({ query }) =>
    [
      query.split(/\s/)[0],
      query.match(/(?:into|from|update) "?([a-z_]+)/)?.[1],
    ].join(' '),
  );

test('commitFriendship reauthorizes and writes the next pair', async () => {
  const { client, queries } = fakeSql([
    [{ declined: false, unrelated: true, daily: 0, hourly: 0 }],
    [],
    [],
    [],
    [],
    [],
    [],
  ]);
  let fences = 0;
  const frame = friendshipFrame(
    drizzle({ client }),
    input,
    [pair],
    async () => {
      fences += 1;
    },
  );
  const change = (
    previous: Parameters<typeof frame.commitFriendship>[0]['previous'],
    next: Parameters<typeof frame.commitFriendship>[0]['next'],
  ) => frame.commitFriendship({ previous, next, requestId, now, limits });
  await change(null, { state: 'pending', requesterActorId: high });
  await change(
    { state: 'pending', requesterActorId: low },
    { state: 'accepted', requesterActorId: low },
  );
  await change({ state: 'accepted', requesterActorId: low }, null);
  assert({
    given: 'a request, an acceptance and a removal',
    should:
      'fence each write, spend the request on the ledger, clear declines on acceptance, and end the pair’s challenges with the friendship',
    actual: [fences, tables(queries), queries[1]?.params.at(-1)],
    expected: [
      3,
      [
        'select messaging_social_declines',
        'insert messaging_social_commands',
        'insert messaging_friendships',
        'delete messaging_social_declines',
        'update messaging_friendships',
        'delete messaging_friendships',
        'delete messaging_friend_challenges',
      ],
      true,
    ],
  });
});

test('declining a friend request counts toward the DEC-251 decline block; cancelling does not', async () => {
  const run = async (requesterActorId: string) => {
    const { client, queries } = fakeSql([[], [], []]);
    await friendshipFrame(
      drizzle({ client }),
      input,
      [pair],
      async () => {},
    ).commitFriendship({
      previous: { state: 'pending', requesterActorId },
      next: null,
      requestId,
      now,
      limits,
    });
    return queries
      .find((entry) =>
        entry.query.includes('insert into messaging_social_declines'),
      )
      ?.params.slice(1, 3);
  };
  assert({
    given: 'the other member’s pending request ended, then the caller’s own',
    should: 'record the caller declining the requester only for the first',
    actual: [await run(low), await run(high)],
    expected: [[high, low], undefined],
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
