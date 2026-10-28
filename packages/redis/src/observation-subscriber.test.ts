import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createObservationSubscriber,
  type SubscriberTransport,
} from './observation-subscriber';
import {
  createObservationKeys,
  parseObservationHint,
} from './observation-cache';

setupRitewayBun();
const id = 'a'.repeat(24);
const resource = { kind: 'channel-messages', id } as const;
const keys = createObservationKeys('test');

function harness() {
  const connections: (SubscriberTransport & {
    channels: string[];
    deliver: (message: string, channel: string) => void;
    fail: () => void;
  })[] = [];
  const pending: (() => void)[] = [];
  const events: string[] = [];
  let listener: (message: string, channel: string) => void = () => {};
  const subscriber = createObservationSubscriber({
    namespace: 'test',
    open: () => {
      const connection = {
        channels: [] as string[],
        onclose: null as ((error: Error) => void) | null,
        connect: async () => {},
        close: () => {},
        subscribe: async (channels: string[], l: typeof listener) => {
          listener = l;
          connection.channels.push(...channels);
          return channels.length;
        },
        unsubscribe: async () => {},
        deliver: (message: string, channel: string) =>
          listener(message, channel),
        fail: () => connection.onclose?.(new Error('lost')),
      };
      connections.push(connection);
      return connection;
    },
    onHint: (r, hint) => events.push(`hint:${r.id === id}:${hint.kind}`),
    onSynchronized: () => events.push('synchronized'),
    onLost: () => events.push('lost'),
    timers: {
      setTimeout: (callback) => pending.push(callback),
      clearTimeout: () => {},
    },
  });
  return { subscriber, connections, pending, events };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const published = JSON.stringify({
  kind: 'published',
  partition: 'members',
  disclosureRevision: 1,
  contentRevision: 2,
});

describe('observation subscriber', () => {
  test('reconnect resubscribes then resynchronizes', async () => {
    const { subscriber, connections, pending, events } = harness();
    await subscriber.observe(resource);
    subscriber.start();
    await settle();
    connections[0]!.deliver(published, keys.hint(resource));
    connections[0]!.fail();
    connections[0]!.deliver(published, keys.hint(resource));
    pending.shift()!();
    await settle();
    connections[1]!.deliver(published, keys.hint(resource));
    assert({
      given: 'a lost connection and a redial',
      should:
        'drop hints while lost, resubscribe every channel on one new connection and report synchronization again',
      actual: [events, connections[1]!.channels],
      expected: [
        [
          'synchronized',
          'hint:true:published',
          'lost',
          'synchronized',
          'hint:true:published',
        ],
        [keys.hint(resource)],
      ],
    });
  });
  test('foreign and malformed hints', async () => {
    const { subscriber, connections, events } = harness();
    await subscriber.observe(resource);
    subscriber.start();
    await settle();
    connections[0]!.deliver('{"kind":"published"}', keys.hint(resource));
    connections[0]!.deliver(
      published,
      keys.hint({ kind: 'channel-messages', id: 'b'.repeat(24) }),
    );
    connections[0]!.deliver(published, 'other:v1:obs:x:hint');
    assert({
      given: 'a malformed hint, an unobserved resource and a foreign channel',
      should: 'deliver nothing',
      actual: events,
      expected: ['synchronized'],
    });
  });
  test('closed is final', async () => {
    const { subscriber, connections, pending } = harness();
    subscriber.start();
    await settle();
    subscriber.close();
    connections[0]!.fail();
    assert({
      given: 'a closed subscriber whose connection then drops',
      should: 'never redial',
      actual: [subscriber.state(), pending.length],
      expected: ['closed', 0],
    });
  });
});

test('observation hints are metadata only', () => {
  assert({
    given: 'a published hint with an extra field, a purge, and junk',
    should: 'parse only the exact shapes',
    actual: [
      parseObservationHint(published),
      parseObservationHint(
        JSON.stringify({ ...JSON.parse(published), body: 'x' }),
      ),
      parseObservationHint('{"kind":"purged"}'),
      parseObservationHint('nope'),
    ],
    expected: [JSON.parse(published), null, { kind: 'purged' }, null],
  });
});
