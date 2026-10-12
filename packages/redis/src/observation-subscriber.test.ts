import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationSubscriber } from './observation-subscriber';
setupRitewayBun();
test('one subscriber owns reconnect repair and disposal', async () => {
  let creates = 0,
    repairs = 0,
    closes = 0;
  const subscriptions = new Map<
    string,
    (message: string, channel: string) => void
  >();
  const client = {
    onconnect: undefined as (() => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    connect: async () => {},
    subscribe: async (
      channel: string,
      listener: (message: string, channel: string) => void,
    ) => {
      subscriptions.set(channel, listener);
    },
    unsubscribe: async (channel: string) => {
      subscriptions.delete(channel);
    },
    close: () => {
      closes++;
    },
  };
  const subscriber = createObservationSubscriber({
    namespace: 'test',
    createClient: () => {
      creates++;
      return client;
    },
    reconcile: async () => {
      repairs++;
    },
  });
  const resource = { kind: 'channel', id: 'a'.repeat(24) } as const;
  const release = await subscriber.interest(resource, () => {});
  await subscriber.reconnect();
  release();
  await subscriber.close();
  await subscriber.close();
  assert({
    given: 'reconnect and repeated disposal',
    should:
      'reuse one native connection and reconcile before becoming synchronized',
    actual: { creates, repairs, closes, ready: subscriber.ready() },
    expected: { creates: 1, repairs: 2, closes: 1, ready: false },
  });
});
