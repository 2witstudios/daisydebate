import { ONLINE_TOPIC } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixture } from './registry.test-support';

setupRitewayBun();

describe('the online ring (ADR 0103)', () => {
  test('reaches a subscriber with no authority read, naming nobody', async () => {
    let reads = 0;
    const { registry, connection, sent } = fixture({
      authorize: async () => {
        reads += 1;
        return { revision: '1', validUntil: 60_000 };
      },
    });
    await registry.subscribe(connection, { id: 'one', topic: ONLINE_TOPIC });
    const afterSubscribe = reads;
    registry.ringOnline();
    registry.ringOnline();
    assert({
      given: 'a subscriber and two rings',
      should: 'send two bare frames and read authority only to subscribe',
      actual: {
        rings: sent.filter((frame) => frame.type === 'online_changed'),
        extraReads: reads - afterSubscribe,
      },
      expected: {
        rings: [
          { v: 1, type: 'online_changed', topic: ONLINE_TOPIC },
          { v: 1, type: 'online_changed', topic: ONLINE_TOPIC },
        ],
        extraReads: 0,
      },
    });
  });

  test('a socket that never subscribed hears nothing', () => {
    const { registry, sent } = fixture();
    registry.ringOnline();
    assert({
      given: 'a ring with no subscriber',
      should: 'send nothing',
      actual: sent,
      expected: [],
    });
  });

  test('a lease past its life misses the ring', async () => {
    const { registry, connection, sent, setNow } = fixture();
    await registry.subscribe(connection, { id: 'one', topic: ONLINE_TOPIC });
    setNow(120_000);
    registry.ringOnline();
    assert({
      given: 'a subscription whose authority lapsed',
      should: 'not send it the ring',
      actual: sent.filter((frame) => frame.type === 'online_changed'),
      expected: [],
    });
  });
});
