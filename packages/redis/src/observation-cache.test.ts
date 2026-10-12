import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTestRedis } from './test-support';
setupRitewayBun();
test('publication is one bounded guarded script and hints contain metadata only', async () => {
  const { redis, commands, scriptEval } = createTestRedis();
  scriptEval(1);
  await redis.publishObservation({
    resource: { kind: 'channel', id: 'a'.repeat(24) },
    incarnation: 'inc',
    token: 'token',
    purgeGeneration: 1,
    base: {
      schema: 1,
      resource: { kind: 'channel', id: 'a'.repeat(24) },
      partition: { kind: 'shared', policyKey: 'v1' },
      disclosureRevision: 1,
      window: { after: null, limit: 50 },
    },
    contentRevision: 2,
    body: 'private message',
    ttlMs: 30000,
  });
  const command = commands.find((item) => item.command === 'EVAL')!;
  assert({
    given: 'a shared protected body',
    should: 'atomically fence both body and head without body-bearing Pub/Sub',
    actual: {
      scripts: commands.filter((item) => item.command === 'EVAL').length,
      guarded: command.args[0]!.includes('owner'),
      separatePublish: commands.some((item) => item.command === 'PUBLISH'),
    },
    expected: { scripts: 1, guarded: true, separatePublish: false },
  });
});
