import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createRedis } from '../src';
import { withRedis } from './test-support';
setupRitewayBun();
const { redisUrl } = requireTestServices(process.env);

test('concurrent request reservations debit once across clients and expire without retaining admission forever', () =>
  withRedis(redisUrl, async ({ namespace, redis, raw, key, expireNow }) => {
    const peer = createRedis({ url: redisUrl, namespace });
    const input = {
      actor: 'actor',
      channel: 'channel',
      request: 'request',
      actorRule: { max: 1, windowSeconds: 60 },
      channelRule: { max: 1, windowSeconds: 60 },
    };
    try {
      const decisions = await Promise.all(
        Array.from({ length: 64 }, (_, index) =>
          (index % 2 ? peer : redis).reserveMessagingSend(input),
        ),
      );
      const reservation = key(
        'messaging-reservation',
        input.actor,
        input.channel,
        input.request,
      );
      assert({
        given: '64 concurrent new-attempt misses on two clients',
        should: 'debit both limits once and arm the bounded reservation',
        actual: [
          decisions.every((decision) => decision.allowed),
          await raw.get(key('rl', 'messaging-send', input.actor)),
          await raw.get(
            key('rl', 'messaging-send', input.actor, input.channel),
          ),
          (await raw.pttl(reservation)) > 0,
        ],
        expected: [true, '1', '1', true],
      });
      await expireNow(reservation);
      assert({
        given: 'the reservation expired while quota remains exhausted',
        should:
          'deny a new reservation rather than treating its old key as durable acceptance',
        actual: (await redis.reserveMessagingSend(input)).allowed,
        expected: false,
      });
    } finally {
      peer.close();
    }
  }));
