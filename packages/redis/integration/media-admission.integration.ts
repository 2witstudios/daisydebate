import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { createPeer, redisSuite, withRedis } from './test-support';
requireTestServices(process.env);
const { redisUrl: url } = redisSuite();
test('admission hints cross web clients, release independently and expire within one lease', () =>
  withRedis(url, async ({ redis, namespace, raw, key, expireNow }) => {
    const peer = createPeer(url, namespace);
    const session = createId(),
      first = createId(),
      second = createId();
    try {
      await redis.mediaAdmissionHint(session, 'enter', first);
      await peer.mediaAdmissionHint(session, 'enter', second);
      const ttl = await raw.pttl(key('media-admission', session));
      const shared = await peer.mediaAdmissionHint(session, 'waiting');
      await redis.mediaAdmissionHint(session, 'leave', first);
      const stillWaiting = await peer.mediaAdmissionHint(session, 'waiting');
      await expireNow(key('media-admission', session));
      const gone = await peer.mediaAdmissionHint(session, 'waiting');
      assert({
        given:
          'independent web connections, two waiting admissions, release and actual expiry',
        should:
          'share priority without one caller deleting another and bound dead waiters to one15s lease',
        actual: [shared, stillWaiting, ttl > 0 && ttl <= 15000, gone],
        expected: [true, true, true, false],
      });
    } finally {
      peer.close();
    }
  }));
