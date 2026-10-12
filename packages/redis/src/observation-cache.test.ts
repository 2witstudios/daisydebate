import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTestRedis } from './test-support';
import {
  observationTestBase,
  observationTestResource,
} from '@daisy/protocol/observation-testing';
setupRitewayBun();
test('publication is one bounded guarded script and hints contain metadata only', async () => {
  const { redis, commands, scriptEval } = createTestRedis();
  scriptEval(1);
  await redis.publishObservation({
    resource: observationTestResource,
    incarnation: 'inc',
    token: 'token',
    purgeGeneration: 1,
    base: observationTestBase(),
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
test('head reads refuse revisions that are not safe non-negative integers', async () => {
  const read = async (reply: unknown) => {
    const { redis, scriptEval } = createTestRedis();
    scriptEval(reply);
    return redis
      .readObservations(observationTestResource, 'inc', [observationTestBase()])
      .then(
        (entries) => entries,
        (error: Error) => error.message,
      );
  };
  assert({
    given:
      'a valid head, a non-numeric revision and an unsafe purge generation',
    should: 'accept only exact integer revisions from Redis',
    actual: [
      await read(['0', ['3', 'body']]),
      await read(['0', ['x', 'body']]),
      await read(['9007199254740993', ['3', 'body']]),
    ],
    expected: [
      [{ contentRevision: 3, purgeGeneration: 0, body: 'body' }],
      'Invalid observation heads',
      'Invalid observation heads',
    ],
  });
});
