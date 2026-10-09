import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createSubscriptionRegistry } from './registry';
import type { OutboxRow } from '@daisy/db';

setupRitewayBun();
const topic = `room:${'b'.repeat(24)}`;
const row = (seq: number): OutboxRow => ({
  txid: '1',
  seq: BigInt(seq),
  topic,
  kind: 'room.changed',
  version: seq,
  payload: { kind: 'room.changed', ids: ['b'.repeat(24)], entityVersion: seq },
  createdAt: '2026-10-09T00:00:00.000Z',
});
function fixture() {
  let now = 0;
  const sent: import('@daisy/protocol').ServerMessage[] = [];
  const attached = new Set<string>();
  const socket = {
    send: (frame: import('@daisy/protocol').ServerMessage) => {
      sent.push(frame);
    },
    subscribe: (value: string) => {
      attached.add(value);
    },
    unsubscribe: (value: string) => {
      attached.delete(value);
    },
    close: () => {},
  };
  const registry = createSubscriptionRegistry({
    now: () => now,
    lifetimeMs: 60_000,
    ringLimit: 2,
    maxSubscriptions: 64,
    authorize: async () => ({ revision: '1', validUntil: now + 60_000 }),
    readCatchup: async () => ({ rows: [], resync: false }),
    publish: (_topic, frame) => {
      sent.push(frame);
    },
  });
  const connection = registry.add(socket, {
    actorId: 'a'.repeat(24),
    sessionId: 'c'.repeat(24),
    userId: 'd'.repeat(24),
  });
  return {
    registry,
    connection,
    sent,
    attached,
    setNow: (value: number) => {
      now = value;
    },
  };
}
describe('subscription registry', () => {
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
