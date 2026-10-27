import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixture, row, topic } from './registry.test-support';

setupRitewayBun();

test('a newer authority bell fences a pending live allow on an attached subscription', async () => {
  let resolve!: (decision: { revision: string; validUntil: number }) => void;
  let started!: () => void;
  const began = new Promise<void>((done) => {
    started = done;
  });
  let checks = 0;
  const { registry, connection, sent, attached } = fixture({
    authorize: async () => {
      checks += 1;
      if (checks === 1) return { revision: '1', validUntil: 60_000 };
      if (checks === 3) return null;
      return new Promise((done) => {
        resolve = done;
        started();
      });
    },
  });
  await registry.subscribe(connection, { id: 'request', topic });
  registry.sink([row(1)]);
  await began;
  registry.sink([row(2)]);
  resolve({ revision: '1', validUntil: 60_000 });
  await registry.settled();
  assert({
    given: 'a newer Room authority bell during a pending live authorization',
    should:
      'discard the old allow and freshly refuse, ending the subscription without publishing either event',
    actual: {
      checks,
      frames: sent.map((frame) => frame.type),
      attached: [...attached],
    },
    expected: { checks: 3, frames: ['subscribed', 'error'], attached: [] },
  });
});

test('a row whose authorization a revalidation fenced is authorized again, not dropped', async () => {
  let resolveFirst!: (decision: {
    revision: string;
    validUntil: number;
  }) => void;
  let checks = 0;
  let began!: () => void;
  const eventStarted = new Promise<void>((done) => {
    began = done;
  });
  const { registry, connection, sent } = fixture({
    authorize: async () => {
      checks += 1;
      if (checks === 2)
        return new Promise((done) => {
          resolveFirst = done;
          began();
        });
      return { revision: '1', validUntil: 60_000 };
    },
  });
  await registry.subscribe(connection, { id: 'request', topic });
  registry.sink([row(1)]);
  await eventStarted;
  await registry.revalidate(async () => true);
  resolveFirst({ revision: '1', validUntil: 60_000 });
  await registry.settled();
  assert({
    given:
      'a revalidation that supersedes a pending event authorization, with no later row',
    should: 'authorize the event again and publish it',
    actual: sent.map((frame) => frame.type),
    expected: ['subscribed', 'event'],
  });
});

test('rows that keep arriving during every authorization are delivered in order, not resynced', async () => {
  const pending: ((decision: {
    revision: string;
    validUntil: number;
  }) => void)[] = [];
  let waiting!: () => void;
  let started = new Promise<void>((done) => {
    waiting = done;
  });
  let checks = 0;
  const { registry, connection, sent } = fixture({
    authorize: async () => {
      checks += 1;
      if (checks === 1) return { revision: '1', validUntil: 60_000 };
      return new Promise((done) => {
        pending.push(done);
        waiting();
      });
    },
  });
  const allow = { revision: '1', validUntil: 60_000 };
  // The next pending authorization, or none once the registry went idle.
  const nextAuthorization = async () => {
    const idle = await Promise.race([
      started.then(() => false),
      registry.settled().then(() => true),
    ]);
    if (idle && pending.length === 0) return undefined;
    started = new Promise<void>((done) => {
      waiting = done;
    });
    return pending.shift();
  };
  await registry.subscribe(connection, { id: 'request', topic });
  registry.sink([row(1)]);
  for (let id = 2; id <= 6; id += 1) {
    const resolve = await nextAuthorization();
    // A newer row's bell lands while this authorization is pending.
    registry.sink([row(id)]);
    resolve?.(allow);
  }
  for (let resolve = await nextAuthorization(); resolve;) {
    resolve(allow);
    resolve = await nextAuthorization();
  }
  assert({
    given:
      'a hot topic whose next row is sunk during each pending authorization',
    should:
      'authorize each fenced row again and publish all six in order, never resyncing',
    actual: sent.map((frame) =>
      frame.type === 'event'
        ? `event:${(frame.payload as { entityVersion: number }).entityVersion}`
        : frame.type,
    ),
    expected: [
      'subscribed',
      ...[1, 2, 3, 4, 5, 6].map((seq) => `event:${seq}`),
    ],
  });
});
