import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixture, row, topic } from './registry.test-support';

setupRitewayBun();

describe('subscription registry delivery', () => {
  test('one recipient publish failure does not poison future drain delivery', async () => {
    let attempts = 0;
    const { registry, connection, socket } = fixture({
      publish: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Recipient unavailable');
      },
    });
    await registry.subscribe(connection, { id: 'first', topic });
    registry.sink([row(1)]);
    await registry.settled();
    const next = registry.add(socket, connection.principal);
    await registry.subscribe(next, { id: 'second', topic });
    registry.sink([row(2)]);
    await registry.settled();
    assert({
      given: 'a transport publication failure in an earlier batch',
      should: 'keep future serialized delivery runnable',
      actual: attempts,
      expected: 2,
    });
  });
  test('authorizes and publishes a validated producer row', async () => {
    const { registry, connection, sent, attached } = fixture();
    await registry.subscribe(connection, { id: 'request', topic });
    registry.sink([row(1)]);
    await registry.settled();
    assert({
      given: 'an authorized native topic and real-shaped producer row',
      should: 'attach and deliver the thin event',
      actual: {
        attached: [...attached],
        types: sent.map((frame) => frame.type),
      },
      expected: { attached: [`${topic}#1`], types: ['subscribed', 'event'] },
    });
  });
  test('expired authority is detached before native publish', async () => {
    const { registry, connection, sent, attached, setNow } = fixture();
    await registry.subscribe(connection, { id: 'request', topic });
    setNow(60_000);
    registry.sink([row(1)]);
    await registry.settled();
    assert({
      given: 'elapsed lease expiry without any timer firing',
      should: 'detach before send',
      actual: {
        attached: [...attached],
        types: sent.map((frame) => frame.type),
      },
      expected: { attached: [], types: ['subscribed'] },
    });
  });
  test('late catch-up allow cannot attach after unsubscribe', async () => {
    const { registry, connection, sent, attached } = fixture();
    const pending = registry.subscribe(connection, { id: 'request', topic });
    registry.unsubscribe(connection, { id: 'remove', topic });
    await pending;
    assert({
      given: 'unsubscribe racing an asynchronous allow',
      should: 'leave no native attachment or subscribed reply',
      actual: {
        attached: [...attached],
        types: sent.map((frame) => frame.type),
      },
      expected: { attached: [], types: ['unsubscribed'] },
    });
  });
});
