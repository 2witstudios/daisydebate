import { assert, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { parseObservationControl } from '../src';
import { redisSuite, withRedis } from './test-support';

requireTestServices(process.env);
const env = redisSuite();
const actorId = 'a'.repeat(24);

test('one relay owns the cursor and fences reach every subscriber', async () => {
  await withRedis(env.redisUrl, async ({ redis }) => {
    const first = await redis.claimObservationRelay('relay-a', 2000);
    const rival = await redis.claimObservationRelay('relay-b', 2000);
    const started = await redis.advanceObservationRelayCursor(
      'relay-a',
      null,
      '10:0',
    );
    const racedStart = await redis.advanceObservationRelayCursor(
      'relay-a',
      null,
      '10:9',
    );
    const stolen = await redis.advanceObservationRelayCursor(
      'relay-b',
      '10:0',
      '10:5',
    );
    const advanced = await redis.advanceObservationRelayCursor(
      'relay-a',
      '10:0',
      '10:3',
    );
    const stale = await redis.advanceObservationRelayCursor(
      'relay-a',
      '10:0',
      '10:4',
    );
    let fence: unknown = null;
    let received: () => void = () => {};
    const delivered = new Promise<void>((resolve) => {
      received = resolve;
    });
    const subscriber = redis.observationSubscriber(
      async () => {},
      (message) => {
        fence = parseObservationControl(message);
        received();
      },
    );
    try {
      await subscriber.reconnect();
      await redis.publishObservationControl({
        kind: 'session',
        actorId,
        sessionId: null,
      });
      await delivered;
      assert({
        given:
          'two relay candidates, racing starts, a stale checkpoint and a published fence',
        should:
          'admit one owner, move the cursor only from its read value, and deliver the fence',
        actual: {
          first,
          rival,
          started,
          racedStart,
          stolen,
          advanced,
          stale,
          cursor: await redis.readObservationRelayCursor(),
          fence,
          tampered: parseObservationControl('{"kind":"session","actorId":"x"}'),
        },
        expected: {
          first: true,
          rival: false,
          started: true,
          racedStart: false,
          stolen: false,
          advanced: true,
          stale: false,
          cursor: '10:3',
          fence: { kind: 'session', actorId, sessionId: null },
          tampered: null,
        },
      });
    } finally {
      await subscriber.close();
    }
  });
});
