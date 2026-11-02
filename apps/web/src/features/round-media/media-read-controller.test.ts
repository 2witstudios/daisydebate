import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaController } from './media-controller';
import { mediaFailure } from './media-failure';
import {
  admission,
  readController,
  roundId,
  snapshot,
  transportStub,
  viewAt,
} from './media-controller.test-support';
import { settle } from './browser-transport.test-support';
setupRitewayBun();

test('new authority supersedes ignored-abort pending read without releasing healthy media', async () => {
  const old = Promise.withResolvers<unknown>();
  let reads = 0,
    admits = 0,
    stops = 0;
  let signal: AbortSignal | undefined;
  const applied: string[] = [],
    received: string[] = [];
  const controller = readController({
    admit: async () => {
      admits++;
      return admission;
    },
    reconcile: async (_id, current) => {
      if (++reads === 2) {
        signal = current;
        return old.promise;
      }
      return {
        ...snapshot,
        grants: { ...snapshot.grants, publish: ['camera'] },
      };
    },
    transport: () => ({
      connect: async () => undefined,
      apply: async (value) => {
        applied.push(value.grants.publish.join(','));
      },
      stopTracks: () => {
        stops++;
      },
      disconnect: async () => undefined,
    }),
    received: (value) => received.push(value.grants.publish.join(',')),
  });
  await controller.join();
  applied.length = 0;
  received.length = 0;
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  void controller.reconcile({
    kind: 'boundary',
    roundViewVersion: 3,
    deadlineMs: 60000,
  });
  void controller.reconcile({ kind: 'view', roundViewVersion: 4 });
  await settle();
  const before = [
    reads >= 3,
    signal?.aborted,
    stops,
    admits,
    controller.state(),
  ];
  old.resolve(snapshot);
  await pending;
  await settle();
  assert({
    given:
      'an old API ignores cancellation across a boundary and newer accepted view',
    should:
      'start fresh immediately, retain healthy connection and exclude all late old applications and receipts',
    actual: [before, applied, received],
    expected: [[true, true, 0, 1, 'live'], ['camera'], ['camera']],
  });
  controller.stop();
});

test('already-started SDK work serializes fresh application without blocking a fresh read', async () => {
  const applying = Promise.withResolvers<void>();
  let reads = 0;
  const applications: string[] = [],
    receipts: string[] = [];
  const controller = readController({
    admit: async () => admission,
    reconcile: async () => {
      reads++;
      return {
        ...snapshot,
        grants: {
          ...snapshot.grants,
          publish: reads < 3 ? ['camera', 'microphone'] : ['camera'],
        },
      };
    },
    transport: () => ({
      connect: async () => undefined,
      apply: async (value) => {
        applications.push(value.grants.publish.join(','));
        if (applications.length === 2) await applying.promise;
      },
      stopTracks: () => undefined,
      disconnect: async () => undefined,
    }),
    received: (value) => receipts.push(value.grants.publish.join(',')),
  });
  await controller.join();
  receipts.length = 0;
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  void controller.reconcile({ kind: 'view', roundViewVersion: 4 });
  await settle();
  const held = [reads, applications.length, receipts.length];
  applying.resolve();
  await pending;
  await settle();
  assert({
    given: 'a newer view while SDK apply has already begun',
    should:
      'read fresh immediately but serialize SDK work and announce only the current ticket',
    actual: [held, applications, receipts],
    expected: [
      [3, 2, 0],
      ['camera,microphone', 'camera,microphone', 'camera'],
      ['camera'],
    ],
  });
  controller.stop();
});

test('old retry pause cannot hold or reuse the new intent signal', async () => {
  const pause = Promise.withResolvers<void>();
  let reads = 0;
  const signals: AbortSignal[] = [];
  const controller = readController({
    admit: async () => admission,
    reconcile: async (_id, signal) => {
      signals.push(signal);
      if (++reads === 2) throw mediaFailure(503);
      return snapshot;
    },
    retry: { delaysMs: [1], wait: () => pause.promise },
  });
  await controller.join();
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  void controller.reconcile({ kind: 'view', roundViewVersion: 4 });
  await settle();
  const before = [reads, signals[1]?.aborted, signals[2]?.aborted];
  pause.resolve();
  await pending;
  await settle();
  assert({
    given:
      'supersession while the old transient retry pause ignores cancellation',
    should:
      'settle its client wait, start one new request and never retry the old ticket using successor signal',
    actual: [before, reads, controller.state()],
    expected: [[3, true, false], 3, 'live'],
  });
  controller.stop();
});

test('stop settles an ignored-abort admission and receipt reentrancy cannot revive media', async () => {
  const held = Promise.withResolvers<unknown>();
  let created = 0,
    settled = false;
  const pendingController = createMediaController({
    roundId,
    initialRoundViewVersion: 3,
    api: { admit: () => held.promise, reconcile: async () => snapshot },
    transport: () => {
      created++;
      throw new Error('Unexpected transport');
    },
    changed: () => undefined,
  });
  const pending = pendingController.join().then(() => {
    settled = true;
  });
  pendingController.stop();
  await settle();
  const stopped = [created, settled, pendingController.state()];
  held.resolve(admission);
  await pending;
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: 3,
    api: { admit: async () => admission, reconcile: async () => snapshot },
    transport: () => transportStub(),
    changed: () => undefined,
    received: () => controller.stop(),
  });
  await controller.join();
  assert({
    given:
      'disposal during uncooperative admission or synchronously from a media receipt',
    should: 'settle join without creating tracks and retain terminal state',
    actual: [stopped, created, controller.state()],
    expected: [[0, true, 'ended'], 0, 'ended'],
  });
});

test('the caller learns when the last answer stopped being current', async () => {
  const held = Promise.withResolvers<unknown>();
  const events: string[] = [];
  let reads = 0;
  const controller = readController({
    reconcile: async () => (++reads === 2 ? held.promise : snapshot),
    superseded: () => events.push('superseded'),
    received: () => events.push('received'),
  });
  await controller.join();
  const newer = controller.reconcile(viewAt(4));
  const same = controller.reconcile({ kind: 'wake' });
  const older = controller.reconcile(viewAt(2));
  await Promise.resolve();
  const whileHeld = [...events];
  held.resolve(snapshot);
  await Promise.all([newer, same, older]);
  assert({
    given: 'an answered read, then a newer view with its read still held',
    should:
      'report one supersession, none for a wake or an older view, and the next answer after it',
    actual: [whileHeld, events.at(-1)],
    expected: [['received', 'superseded'], 'received'],
  });
  controller.stop();
});
