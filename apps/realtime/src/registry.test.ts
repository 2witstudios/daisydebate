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
    readRetentionBoundary: async () => ({ txid: '0', seq: 0n }),
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
  test('a write racing history I/O replays the snapshot then certified ring without duplication', async () => {
    let resolve!: (value: {
      rows: readonly OutboxRow[];
      resync: boolean;
    }) => void;
    let started!: () => void;
    const began = new Promise<void>((done) => {
      started = done;
    });
    const { registry, connection, sent } = fixture({
      readCatchup: () =>
        new Promise((done) => {
          resolve = done;
          started();
        }),
    });
    registry.seed({ txid: '1', seq: 1n });
    const pending = registry.subscribe(connection, {
      id: 'request',
      topic,
      since: '0:0',
    });
    await began;
    registry.sink([row(2)]);
    resolve({ rows: [row(1)], resync: false });
    await pending;
    await registry.settled();
    assert({
      given:
        'a retained history snapshot followed by a same-topic write during its await',
      should:
        'freshly authorize and replay snapshot+bounded ring once before acknowledgement',
      actual: sent.map((frame) =>
        frame.type === 'event' ? frame.position : frame.type,
      ),
      expected: ['1:1', '1:2', 'subscribed'],
    });
  });
  test('a purge that advances past a stalled drain cursor refuses replay', async () => {
    const { registry, connection, sent } = fixture({
      readCatchup: async () => ({
        rows: [{ ...row(3), txid: '3' }],
        resync: false,
      }),
      readRetentionBoundary: async () => ({ txid: '2', seq: 2n }),
    });
    registry.seed({ txid: '1', seq: 1n });
    registry.sink([{ ...row(3), txid: '3' }]);
    await registry.settled();
    await registry.subscribe(connection, {
      id: 'request',
      topic,
      since: '1:1',
    });
    assert({
      given: 'undrained 2:2 pruned between cursor1:1 and observed3:3',
      should: 'refuse even a cached or optimistic replay result',
      actual: sent.map((frame) => frame.type),
      expected: ['resync_required'],
    });
  });
  for (const race of ['expiry', 'drain'] as const)
    test(`${race} during the final boundary read cannot attach`, async () => {
      let resolve!: (value: { txid: string; seq: bigint }) => void;
      let started!: () => void;
      const began = new Promise<void>((done) => {
        started = done;
      });
      const { registry, connection, sent, attached, setNow } = fixture({
        readRetentionBoundary: () =>
          new Promise((done) => {
            resolve = done;
            started();
          }),
      });
      registry.seed({ txid: '1', seq: 1n });
      const pending = registry.subscribe(connection, {
        id: 'request',
        topic,
        since: '1:1',
      });
      await began;
      if (race === 'expiry') setNow(60_000);
      else registry.sink([row(2)]);
      resolve({ txid: '0', seq: 0n });
      await pending;
      assert({
        given: `${race} advances during the final durable metadata await`,
        should: 'send no event/subscribed or native attachment',
        actual: {
          types: sent.map((frame) => frame.type),
          attached: [...attached],
        },
        expected: { types: ['resync_required'], attached: [] },
      });
    });
  for (const bell of [false, true])
    test(`last replay await fences ${bell ? 'pending authority invalidation' : 'ring eviction'}`, async () => {
      let resolve!: (value: { revision: string; validUntil: number }) => void;
      let calls = 0;
      let started!: () => void;
      const began = new Promise<void>((done) => {
        started = done;
      });
      const { registry, connection, sent, attached } = fixture({
        authorize: () =>
          ++calls === 2
            ? new Promise((done) => {
                resolve = done;
                started();
              })
            : Promise.resolve({ revision: '1', validUntil: 60_000 }),
      });
      registry.seed({ txid: '1', seq: 1n });
      const pending = registry.subscribe(connection, {
        id: 'request',
        topic,
        since: '1:1',
      });
      await began;
      const rows = [2, 3, 4].map((seq) =>
        bell
          ? row(seq)
          : {
              ...row(seq),
              topic: `room:${'e'.repeat(24)}`,
              payload: {
                kind: 'room.changed',
                ids: ['e'.repeat(24)],
                entityVersion: seq,
              },
            },
      );
      registry.sink(rows);
      resolve({ revision: '1', validUntil: 60_000 });
      await pending;
      await registry.settled();
      assert({
        given: 'a replay authorization await while drain advances',
        should:
          'refuse the still-current request before any replay or attachment',
        actual: {
          types: sent.map((frame) => frame.type),
          attached: [...attached],
        },
        expected: { types: ['resync_required'], attached: [] },
      });
      await registry.subscribe(connection, { id: 'retry', topic });
      assert({
        given: 'a refused pending request',
        should: 'permit a fresh subscription rather than strand initialization',
        actual: sent.at(-1)?.type,
        expected: 'subscribed',
      });
    });
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
  test('an observed ring cannot bypass the durable completeness refusal', async () => {
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
      given:
        'a cursor that retention may have overtaken before drain observed the next row',
      should:
        'consult the durable adapter and resync without silently missing history',
      actual: { reads, types: sent.map((frame) => frame.type) },
      expected: { reads: 1, types: ['resync_required'] },
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
