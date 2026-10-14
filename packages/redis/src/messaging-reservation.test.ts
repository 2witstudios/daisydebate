import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTestRedis } from './test-support';
setupRitewayBun();
test('messaging reservations carry both budgets and one expiring request identity atomically', async () => {
  const { redis, commands } = createTestRedis();
  await redis.reserveMessagingSend({
    actor: 'actor',
    channel: 'channel',
    request: 'request',
    actorRule: { max: 5, windowSeconds: 60 },
    channelRule: { max: 2, windowSeconds: 10 },
  });
  const evals = commands.filter(({ command }) => command === 'EVAL');
  assert({
    given: 'one new-attempt reservation',
    should: 'use one script over three namespaced keys with a bounded expiry',
    actual: evals.map(({ args }) => args.slice(1)),
    expected: [
      [
        '3',
        'test:v1:messaging-reservation:actor:channel:request',
        'test:v1:rl:messaging-send:actor',
        'test:v1:rl:messaging-send:actor:channel',
        '30000',
        '60000',
        '5',
        '10000',
        '2',
      ],
    ],
  });
});
