import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationProvider } from './observation-provider';
import type { ObservationServerMessage } from '@daisy/protocol';
import {
  readyFrame,
  snapshotFrame,
  testDescriptor,
  recordingSubscriptions,
  testTimers,
} from './observation.test-support';
setupRitewayBun();
for (const disposal of ['provider', 'reader'] as const)
  test(`reentrant ${disposal} disposal leaves no deadline timer`, () => {
    let incoming!: (frame: ObservationServerMessage) => void;
    const clock = testTimers();
    const provider = createObservationProvider({
      connection: {
        connect: () => {},
        dispose: () => {},
        subscribe: () => () => {},
        observe: (_descriptor, listener) => {
          incoming = listener;
          return () => {};
        },
      },
      scheduler: clock.scheduler,
    });
    const reader = provider.observe(testDescriptor);
    reader.subscribe(() => {
      if (reader.read().status === 'pending') {
        if (disposal === 'provider') provider.dispose();
        else reader.close();
      }
    });
    incoming(readyFrame({ validForMs: 100 }));
    assert({
      given: `${disposal} disposal during synchronous pending notification`,
      should: 'remain disposed without creating timers after final cleanup',
      actual: { state: reader.read().status, timers: clock.timers.size },
      expected: { state: 'disposed', timers: 0 },
    });
    provider.dispose();
  });
test('provider owns one connection, reference counts and final deadline hiding', () => {
  let now = 0,
    connects = 0,
    disposals = 0;
  const callbacks = new Set<(frame: ObservationServerMessage) => void>();
  const clock = testTimers(() => now);
  const provider = createObservationProvider({
    connection: {
      connect: () => {
        connects++;
      },
      dispose: () => {
        disposals++;
      },
      subscribe: () => () => {},
      observe: (_descriptor, listener) => {
        callbacks.add(listener);
        return () => {
          callbacks.delete(listener);
        };
      },
    },
    scheduler: clock.scheduler,
  });
  const first = provider.observe(testDescriptor),
    second = provider.observe(testDescriptor);
  for (const callback of callbacks) {
    callback(readyFrame({ validForMs: 100 }));
    callback(snapshotFrame());
  }
  first.close();
  const visible = second.read().content;
  now = 100;
  clock.fire();
  const hidden = second.read().content;
  provider.dispose();
  provider.dispose();
  assert({
    given: 'two readers and elapsed authority followed by final disposal',
    should:
      'share a single connection/interest, hide at deadline, release every resource once',
    actual: {
      connects,
      disposals,
      visible,
      hidden,
      callbacks: callbacks.size,
      timers: clock.timers.size,
    },
    expected: {
      connects: 1,
      disposals: 1,
      visible: 'shared',
      hidden: null,
      callbacks: 0,
      timers: 0,
    },
  });
});

test('correlated reconnect can install a lower generation from a new server incarnation', () => {
  const { subscriptions, sent } = recordingSubscriptions();
  const provider = createObservationProvider({
    connection: {
      connect: () => {},
      dispose: () => subscriptions.dispose(),
      subscribe: () => () => {},
      observe: subscriptions.observe,
    },
    scheduler: testTimers().scheduler,
  });
  const reader = provider.observe(testDescriptor);
  const send = (generation: number, revision: number, body: string) => {
    const id = sent.at(-1)!.id;
    subscriptions.emit(
      readyFrame({ id, generation, minimumContentRevision: revision }),
    );
    subscriptions.emit(
      snapshotFrame({ id, generation, contentRevision: revision, body }),
    );
  };
  send(7, 1, 'old');
  const oldRequest = sent.at(-1)!.id;
  subscriptions.reconnect();
  send(0, 2, 'current');
  subscriptions.emit(
    snapshotFrame({
      id: oldRequest,
      generation: 99,
      contentRevision: 999,
      body: 'stale-incarnation',
    }),
  );
  assert({
    given: 'new request ID and a replacement server starting generation zero',
    should: 'fence the prior request and install current authorized baseline',
    actual: reader.read().content,
    expected: 'current',
  });
  provider.dispose();
});
