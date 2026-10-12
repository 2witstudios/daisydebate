import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationSubscriber } from './observation-subscriber';
setupRitewayBun();
/** A native subscriber transport that records subscribed channels. */
function channelClient(
  beforeUnsubscribe: () => Promise<void> = async () => {},
) {
  const channels = new Map<
    string,
    (message: string, channel: string) => void
  >();
  let closes = 0;
  const client = {
    onconnect: undefined as (() => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    connect: async () => {},
    subscribe: async (
      channel: string,
      listener: (message: string, channel: string) => void = () => {},
    ) => {
      channels.set(channel, listener);
    },
    unsubscribe: async (channel: string) => {
      await beforeUnsubscribe();
      channels.delete(channel);
    },
    close: () => {
      closes++;
    },
  };
  return { client, channels, closes: () => closes };
}
test('one subscriber owns reconnect repair and disposal', async () => {
  let creates = 0,
    repairs = 0;
  const { client, closes } = channelClient();
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
    actual: { creates, repairs, closes: closes(), ready: subscriber.ready() },
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

test('failed baseline admission unwinds native subscription', async () => {
  const { client, channels } = channelClient();
  let unavailable = true;
  const subscriber = createObservationSubscriber({
    namespace: 'test',
    createClient: () => client,
    reconcile: async () => {
      if (unavailable) throw new Error('unavailable');
    },
  });
  try {
    await subscriber.interest(
      { kind: 'channel', id: 'a'.repeat(24) },
      () => {},
    );
  } catch {
    /* Failure is expected; disposal still owns the native subscription. */
  }
  unavailable = false;
  await subscriber.reconnect();
  assert({
    given: 'subscribe succeeded but baseline reconciliation rejected',
    should: 'unwind failed admission before ready can be reported',
    actual: { channels: channels.size, ready: subscriber.ready() },
    expected: { channels: 0, ready: true },
  });
  await subscriber.close();
});

test('same-channel rejoin waits out in-flight unsubscribe before baseline', async () => {
  let mark!: () => void, resume!: () => void;
  const started = new Promise<void>((resolve) => {
      mark = resolve;
    }),
    wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
  const { client, channels } = channelClient(async () => {
    mark();
    await wait;
  });
  const subscriber = createObservationSubscriber({
      namespace: 'test',
      createClient: () => client,
      reconcile: async () => {},
    }),
    resource = { kind: 'channel', id: 'a'.repeat(24) } as const;
  const release = await subscriber.interest(resource, () => {});
  release();
  await started;
  const rejoining = subscriber.interest(resource, () => {});
  resume();
  const final = await rejoining;
  assert({
    given: 'an in-flight final unsubscribe overlapping same-resource rejoin',
    should: 'serialize channel operations and restore baseline before ready',
    actual: { channels: channels.size, ready: subscriber.ready() },
    expected: { channels: 1, ready: true },
  });
  final();
  await subscriber.close();
});
