import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { createPeer, redisSuite, withRedis } from './test-support';
// redisSuite requires the test services and sets up RITEway.
const { redisUrl: url } = redisSuite();
test("capture's heard-track report crosses peer clients for its Round only, and expires (DEC-226)", () =>
  withRedis(url, async ({ redis, namespace, raw, key, expireNow }) => {
    const peer = createPeer(url, namespace);
    const roundId = createId(),
      seat = createId();
    try {
      await redis.writeCaptureHeard({ roundId, trackId: 'TR_heard1', seat });
      const heardKey = key('captureheard', roundId, 'TR_heard1');
      const ttl = await raw.pttl(heardKey);
      assert({
        given: "capture's report that it hears a bot seat's track",
        should:
          'give a peer the seat for that Round and track only, under an expiry',
        actual: [
          await peer.readCaptureHeard(roundId, 'TR_heard1'),
          await peer.readCaptureHeard(createId(), 'TR_heard1'),
          await peer.readCaptureHeard(roundId, 'TR_other'),
          ttl > 0 && ttl <= 30000,
        ],
        expected: [seat, null, null, true],
      });
      await expireNow(heardKey);
      assert({
        given: 'the expired report',
        should: 'read as not heard',
        actual: await peer.readCaptureHeard(roundId, 'TR_heard1'),
        expected: null,
      });
    } finally {
      peer.close();
    }
  }));
