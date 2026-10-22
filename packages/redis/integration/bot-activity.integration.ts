import { requireTestServices } from '@daisy/config';
import { botActivityFixture } from '@daisy/protocol/bot-activity-testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { createRedis } from '../src';
import { createBoundedTestClient } from '../src/testing';
import { redisSuite, withRedis } from './test-support';
requireTestServices(process.env);
const { redisUrl: url } = redisSuite();
test('actual expiring activity crosses independent peer clients without changing its original timestamps', () =>
  withRedis(url, async ({ redis, namespace, raw, key, expireNow }) => {
    const peer = createRedis({
      url,
      namespace,
      client: createBoundedTestClient(url),
    });
    const batch = botActivityFixture(createId(), createId());
    try {
      assert({
        given: 'the actual isolated Redis persistence capability',
        should: 'report only the requested metadata',
        actual: Object.entries(
          (await raw.send('CONFIG', ['GET', 'appendonly', 'save'])) as Record<
            string,
            string
          >,
        ).sort(),
        expected: [
          ['appendonly', 'no'],
          ['save', ''],
        ],
      });
      await redis.writeBotActivity(batch);
      const actual = await peer.readBotActivity(
        batch.roundId,
        batch.roundParticipantId,
      );
      const activityKey = key(
        'botactivity',
        batch.roundId,
        batch.roundParticipantId,
      );
      const ttl = await raw.pttl(activityKey);
      assert({
        given:
          'independent actual Redis peer connections with memory-only capability',
        should:
          'deliver exact original scoped batch and require an expiry of at most1s',
        actual: [actual, ttl > 0 && ttl <= 1000],
        expected: [batch, true],
      });
      await expireNow(activityKey);
      assert({
        given: 'actual key expiry',
        should: 'return missing rather than manufacture activity',
        actual: await peer.readBotActivity(
          batch.roundId,
          batch.roundParticipantId,
        ),
        expected: null,
      });
    } finally {
      peer.close();
    }
  }));
