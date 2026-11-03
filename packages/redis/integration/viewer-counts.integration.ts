import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { redisSuite, withRedis } from './test-support';

const { redisUrl: url } = redisSuite();

test('a bucket counts distinct tabs, keeps no token and expires by itself', () =>
  withRedis(url, async ({ redis, raw, key }) => {
    const roundId = createId();
    const tokens = [createId(), createId(), createId()];
    for (const token of [...tokens, tokens[0]!])
      await redis.recordViewerPulse({
        roundId,
        bucket: 7,
        token,
        ttlMs: 60_000,
      });
    const scoped = key('viewers', roundId, '7');
    const ttl = await raw.pttl(scoped);
    assert({
      given: 'four pulses from three tabs in one bucket',
      should:
        'count three, in a key with an expiry; an empty bucket counts none',
      actual: {
        count: await redis.readViewerCount(roundId, 7),
        empty: await redis.readViewerCount(roundId, 8),
        expires: ttl > 0 && ttl <= 60_000,
      },
      expected: { count: 3, empty: 0, expires: true },
    });
  }));
