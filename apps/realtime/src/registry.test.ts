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
function fixture(
  overrides: Partial<Parameters<typeof createSubscriptionRegistry>[0]> = {},
) {
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
    ...overrides,
  });
  const connection = registry.add(socket, {
    actorId: 'a'.repeat(24),
    sessionId: 'c'.repeat(24),
    userId: 'd'.repeat(24),
  });
  return {
    registry,
    connection,
    socket,
    sent,
    attached,
    setNow: (value: number) => {
      now = value;
    },
  };
}
describe('subscription registry', () => {
  test('canonical denial after catchup refuses replay even without a bell', async () => {
    let calls = 0;
    const { registry, connection, sent, attached } = fixture({
      authorize: async () =>
        ++calls === 1 ? { revision: '1', validUntil: 60_000 } : null,
      readCatchup: async () => ({ rows: [row(1)], resync: false }),
    });
    await registry.subscribe(connection, {
      id: 'request',
      topic,
      since: '1:1',
    });
    assert({
      given:
        'permission removed after the initial allow without a delivered control',
      should: 'reread before replay and deny attachment',
      actual: {
        calls,
        attached: [...attached],
        types: sent.map((frame) => frame.type),
      },
      expected: { calls: 2, attached: [], types: ['error'] },
    });
  });
  test('an observed ring supports reconnect without certifying durable gaps', async () => {
    let reads = 0;
    const { registry, connection, sent } = fixture({
      readCatchup: async () => {
        reads += 1;
        return { rows: [], resync: true };
      },
    });
    registry.seed({ txid: '1', seq: 1n });
    registry.sink([row(2)]);
    await registry.settled();
    await registry.subscribe(connection, {
      id: 'request',
      topic,
      since: '1:1',
    });
    assert({
      given: 'a cursor covered by the continuously observed ring',
      should:
        'replay after fresh authorization without trusting an SQL survivor floor',
      actual: { reads, types: sent.map((frame) => frame.type) },
      expected: { reads: 0, types: ['event', 'subscribed'] },
    });
  });
  test('access changed while catchup waits cannot replay an old allow', async () => {
    let resolve!: (value: {
      rows: readonly OutboxRow[];
      resync: boolean;
    }) => void;
    let allowed = true;
    const { registry, connection, sent, attached } = fixture({
      authorize: async () =>
        allowed ? { revision: '1', validUntil: 60_000 } : null,
      readCatchup: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const pending = registry.subscribe(connection, {
      id: 'request',
      topic,
      since: '1:1',
    });
    await Promise.resolve();
    allowed = false;
    registry.sink([row(2)]);
    resolve({ rows: [row(1)], resync: false });
    await pending;
    await registry.settled();
    assert({
      given: 'revoked access and a changed row during asynchronous catchup',
      should: 'send no event or subscribed reply and never attach',
      actual: {
        attached: [...attached],
        forbidden: sent.some((frame) =>
          ['event', 'subscribed'].includes(frame.type),
        ),
      },
      expected: { attached: [], forbidden: false },
    });
  });
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
