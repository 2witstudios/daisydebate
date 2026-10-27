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
