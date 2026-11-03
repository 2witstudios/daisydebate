import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  admission,
  readHarness,
  snapshot,
  transportStub,
} from './media-fixtures.test-support';
import { settle } from './adapters/livekit-room.test-support';
setupRitewayBun();

test('connection replacement fences old rejection and cleanup', async () => {
  const held = Promise.withResolvers<unknown>();
  let reads = 0,
    admits = 0;
  const stopped: number[] = [];
  const controller = readHarness({
    admit: async () => {
      admits++;
      return admission;
    },
    reconcile: async () => (++reads === 2 ? held.promise : snapshot),
    transport: () => {
      const index = stopped.length;
      stopped.push(0);
      return {
        ...transportStub(),
        stopTracks: () => {
          stopped[index]!++;
        },
      };
    },
  });
  await controller.join();
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  await controller.reconnect();
  await pending;
  held.reject(new Error('Late old network failure'));
  await settle();
  assert({
    given:
      'reconnect replaces a connection with an ignored-abort read, which later rejects',
    should:
      'release only the old connection and preserve the fresh flight and state',
    actual: [admits, stopped, reads, controller.state()],
    expected: [2, [1, 0], 3, 'live'],
  });
  controller.stop();
});

test('accepted views during admission and first read use current intent without admission restart', async () => {
  const mint = Promise.withResolvers<unknown>(),
    held = Promise.withResolvers<unknown>();
  let admits = 0,
    connects = 0,
    reads = 0;
  let signal: AbortSignal | undefined;
  const receipts: string[] = [];
  const controller = readHarness({
    admit: async () => {
      admits++;
      return mint.promise;
    },
    reconcile: async (_id, current) => {
      if (++reads === 1) {
        signal = current;
        return held.promise;
      }
      return {
        ...snapshot,
        grants: { ...snapshot.grants, publish: ['camera'] },
      };
    },
    transport: () => ({
      ...transportStub(),
      connect: async () => {
        connects++;
      },
    }),
    received: (value) => receipts.push(value.grants.publish.join(',')),
  });
  const joining = controller.join();
  void controller.reconcile({ kind: 'view', roundViewVersion: 4 });
  mint.resolve(admission);
  await settle();
  void controller.reconcile({ kind: 'view', roundViewVersion: 5 });
  await joining;
  held.resolve(snapshot);
  await settle();
  assert({
    given:
      'a new view during admission and another while initial reconcile remains pending',
    should:
      'record intent, cancel the obsolete first read and finish the same connection with current media',
    actual: [
      admits,
      connects,
      reads,
      signal?.aborted,
      receipts,
      controller.state(),
    ],
    expected: [1, 1, 2, true, ['camera'], 'live'],
  });
  controller.stop();
});

test('release callbacks cannot revive a synchronously disposed replacement', async () => {
  let disposeOnRelease = false,
    admits = 0;
  const controller = readHarness({
    admit: async () => {
      admits++;
      return admission;
    },
    reconcile: async () => snapshot,
    transport: () => ({
      ...transportStub(),
      stopTracks: () => {
        if (disposeOnRelease) controller.stop();
      },
    }),
  });
  await controller.join();
  disposeOnRelease = true;
  await controller.reconnect();
  assert({
    given:
      'synchronous disposal from old transport release while reconnect begins',
    should: 'keep ended state and never start replacement admission',
    actual: [controller.state(), admits],
    expected: ['ended', 1],
  });
});
