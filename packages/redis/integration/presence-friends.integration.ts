import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, test } from 'riteway/bun';
import { lease, redisSuite, withRedis } from './test-support';

requireTestServices(process.env);
const { redisUrl: url } = redisSuite();

test('several actors’ presence and the online count come from live leases', () =>
  withRedis(url, async ({ redis }) => {
    const [active, idle, mixed, offline] = [
      createId(),
      createId(),
      createId(),
      createId(),
    ];
    await redis.upsertPresenceLease(lease('connP1', active, 'active'), 60);
    await redis.upsertPresenceLease(lease('connP2', idle, 'idle'), 60);
    await redis.upsertPresenceLease(lease('connP3', mixed, 'idle'), 60);
    await redis.upsertPresenceLease(lease('connP4', mixed, 'active'), 60);
    assert({
      given: 'an active, an idle, a mixed and an offline actor',
      should:
        'report active, idle, active and null, and count three online',
      actual: [
        [
          ...(
            await redis.readActorsPresence([active, idle, mixed, offline])
          ).values(),
        ],
        await redis.countOnlinePresence(),
      ],
      expected: [['active', 'idle', 'active', null], 3],
    });
    await redis.deletePresenceLease({ connId: 'connP1', actorId: active });
    assert({
      given: 'the active actor’s clean disconnect',
      should: 'show them offline and count two online',
      actual: [
        (await redis.readActorsPresence([active])).get(active),
        await redis.countOnlinePresence(),
      ],
      expected: [null, 2],
    });
  }));
