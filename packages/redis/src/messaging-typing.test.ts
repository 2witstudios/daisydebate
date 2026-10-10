import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTestRedis, createOutageRedis } from './test-support';
setupRitewayBun();
const actorId = 'a'.repeat(24),
  channelId = 'c'.repeat(24);
const lease = {
  version: 1 as const,
  channelId,
  actorId,
  authorityRevision: 2,
  relationshipRevision: 3,
  accountRevision: 4,
  ageRevision: 5,
  policyRevision: 1,
  expiresAt: '2026-10-10T12:00:01.000Z',
};
test('typing lease adapter binds actor/channel keys and explicit millisecond expiry', async () => {
  const { redis, commands, scriptEval } = createTestRedis();
  await redis.writeTypingLease(lease, 1000);
  await redis.clearTypingLease(channelId, actorId);
  scriptEval([JSON.stringify(lease), null]);
  const result = await redis.readTypingLeases(
    channelId,
    [actorId, 'b'.repeat(24)],
    2,
  );
  assert({
    given: 'validated current cast and explicit lease lifetime',
    should:
      'write bounded namespaced lease and return only correctly bound decoded values',
    actual: [
      commands.find((row) => row.command === 'SET')?.args,
      commands.find((row) => row.command === 'DEL')?.args,
      result,
    ],
    expected: [
      [
        `test:v1:messaging-typing:${actorId}:${channelId}`,
        JSON.stringify(lease),
        'PX',
        '1000',
      ],
      [`test:v1:messaging-typing:${actorId}:${channelId}`],
      [lease],
    ],
  });
});
test('typing adapter rejects malformed bindings and over-budget reads before Redis', async () => {
  const { redis, commands, scriptEval } = createTestRedis();
  for (const run of [
    () => redis.writeTypingLease({ ...lease, accountRevision: 0 }, 1000),
    () => redis.writeTypingLease(lease, 0),
    () => redis.readTypingLeases(channelId, [actorId, actorId], 2),
    () => redis.readTypingLeases(channelId, [actorId], 0),
    () => redis.clearTypingLease('invalid', actorId),
  ])
    await expect(run()).rejects.toThrow('Invalid typing lease input');
  assert({
    given: 'invalid input',
    should: 'perform no Redis I/O',
    actual: commands,
    expected: [],
  });
  scriptEval([JSON.stringify({ ...lease, actorId: 'b'.repeat(24) })]);
  await expect(redis.readTypingLeases(channelId, [actorId], 1)).rejects.toThrow(
    'Invalid typing lease response',
  );
  const { redis: offline, events } = createOutageRedis();
  await expect(offline.writeTypingLease(lease, 1000)).rejects.toThrow(
    'offline',
  );
  assert({
    given: 'unavailable Redis',
    should: 'report only operation name and never fabricate typing state',
    actual: events.map((row) => row.fields),
    expected: [{ operation: 'writeTypingLease' }],
  });
});
