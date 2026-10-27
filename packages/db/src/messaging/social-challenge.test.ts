import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { challengeFrame } from './social-challenge';
setupRitewayBun();

const low = 'a'.repeat(24),
  high = 'b'.repeat(24),
  room = 'r'.repeat(24);
const pair = {
  lowActorId: low,
  highActorId: high,
  lowBlocksHigh: false,
  highBlocksLow: false,
  revision: 1,
};
const input = {
  actorId: high,
  userId: 'u'.repeat(24),
  memberActorIds: [low, high],
};
const now = '2026-10-26T18:00:00.000Z';

test('commitChallenge records only a room the caller hosts while it assembles', async () => {
  const { client, queries } = fakeSql([
    [],
    [[room]],
    [],
    [],
    [],
    [],
    [],
    [{ recorded: 1 }],
  ]);
  let fences = 0;
  const frame = challengeFrame(drizzle({ client }), input, [pair], async () => {
    fences += 1;
  });
  const recorded = await frame.commitChallenge({ roomId: room, now });
  const missing = await frame.commitChallenge({ roomId: room, now });
  const repeat = await frame.commitChallenge({ roomId: room, now });
  const fallback = queries.at(-1)?.query ?? '';
  assert({
    given:
      'a room already challenging the same friend, while the caller still hosts it open',
    should:
      'record the repeat Challenge, guarding the read by host and open status like the insert (E5)',
    actual: [
      repeat,
      fallback.includes('r.host_actor_id'),
      fallback.includes("r.status in ('assembling', 'ready')"),
      fallback.includes('c.challenged_actor_id'),
    ],
    expected: [{ recorded: true }, true, true, true],
  });
  assert({
    given: 'a challenge the room check admits, then one it does not',
    should:
      'fence each write, drop the pair’s spent challenges, insert for the pair’s other member, and report whether it recorded',
    actual: [
      fences,
      recorded,
      missing,
      queries[0]?.query.includes("r.status not in ('assembling', 'ready')"),
      queries[1]?.query.includes('r.host_actor_id'),
      queries[1]?.query.includes("r.status in ('assembling', 'ready')"),
      queries[1]?.params.slice(0, 2),
    ],
    expected: [
      3,
      { recorded: true },
      { recorded: false },
      true,
      true,
      true,
      [high, low],
    ],
  });
});

test('declineChallenge deletes only the other member’s challenge to the caller', async () => {
  const { client, queries } = fakeSql([[]]);
  await challengeFrame(
    drizzle({ client }),
    input,
    [pair],
    async () => {},
  ).declineChallenge({
    roomId: room,
  });
  assert({
    given: 'a decline',
    should: 'delete by room, challenged caller and challenging counterpart',
    actual: queries[0]?.params,
    expected: [room, high, low],
  });
  await assertRejects({
    given: 'a malformed room id',
    should: 'refuse before any write',
    actual: () =>
      challengeFrame(
        drizzle({ client }),
        input,
        [pair],
        async () => {},
      ).declineChallenge({
        roomId: 'x',
      }),
    code: 'VALIDATION',
  });
});
