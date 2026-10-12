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

test('listeners precede baseline and interests arriving during repair are subscribed', async () => {
  const subscribed = new Map<
    string,
    (message: string, channel: string) => void
  >();
  let unblock!: () => void,
    markStarted!: () => void,
    repairs = 0,
    first = 0,
    second = 0;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const client = {
    onconnect: undefined as (() => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    connect: async () => {},
    subscribe: async (
      channel: string,
      handler: (message: string, channel: string) => void,
    ) => {
      subscribed.set(channel, handler);
    },
    unsubscribe: async () => {},
    close: () => {},
  };
  const subscriber = createObservationSubscriber({
    namespace: 'test',
    createClient: () => client,
    reconcile: async () => {
      repairs++;
      if (repairs === 1) {
        for (const [channel, handler] of subscribed) handler('hint', channel);
        markStarted();
        await paused;
      }
    },
  });
  const a = { kind: 'channel', id: 'a'.repeat(24) } as const,
    b = { kind: 'channel', id: 'b'.repeat(24) } as const;
  const attaching = subscriber.interest(a, () => {
    first++;
  });
  await started;
  const joining = subscriber.interest(b, () => {
    second++;
  });
  unblock();
  const releaseA = await attaching,
    releaseB = await joining;
  const releaseSecond = await subscriber.interest(a, () => {
    second++;
  });
  assert({
    given:
      'a hint inside first reconciliation, concurrent new resource and acknowledged second listener',
    should:
      'install listeners before races and repair all memberships before ready',
    actual: {
      first: first > 0,
      second: second > 0,
      channels: subscribed.size,
      ready: subscriber.ready(),
    },
    expected: { first: true, second: true, channels: 2, ready: true },
  });
  releaseA();
  releaseB();
  releaseSecond();
  await subscriber.close();
});
