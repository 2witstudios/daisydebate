import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createMediaController,
  type BrowserMediaTransport,
} from './media-controller';
import { admission, snapshot, roundId } from './media-controller.test-support';
import { settle } from './browser-transport.test-support';
setupRitewayBun();

const transport = (
  overrides: Partial<BrowserMediaTransport> = {},
): BrowserMediaTransport => ({
  connect: async () => undefined,
  apply: async () => undefined,
  stopTracks: () => undefined,
  disconnect: async () => undefined,
  ...overrides,
});
const version = (value: number) =>
  ({ kind: 'view', roundViewVersion: value }) as const;

test('a reply superseded in any microtask gap never ends or fails its successor', async () => {
  const results = new Set<string>();
  for (const late of [
    { ...snapshot, state: 'ended' },
    { ...snapshot, roundId: 'x'.repeat(24) },
    { ...snapshot, state: 'unavailable' },
  ])
    for (let gap = 0; gap < 12; gap++) {
      const held = Promise.withResolvers<unknown>();
      let reads = 0;
      let stops = 0;
      const controller = createMediaController({
        roundId,
        initialRoundViewVersion: 3,
        api: {
          admit: async () => admission,
          reconcile: async () => (++reads === 2 ? held.promise : snapshot),
        },
        transport: () =>
          transport({
            stopTracks: () => {
              stops++;
            },
          }),
        changed: () => undefined,
      });
      await controller.join();
      const pending = controller.reconcile({ kind: 'wake' });
      await settle();
      held.resolve(late);
      for (let tick = 0; tick < gap; tick++) await Promise.resolve();
      // A reply already acted on is not obsolete; only a live connection counts.
      if (controller.state() === 'live' && stops === 0) {
        void controller.reconcile(version(4));
        await pending;
        await settle();
        results.add(`${controller.state()}:${stops}`);
      }
      controller.stop();
    }
  assert({
    given:
      'a newer view landing in each microtask gap after a bad reply settles',
    should: 'leave the successor live with its connection intact',
    actual: [...results],
    expected: ['live:0'],
  });
});

test('a queued fresh reply superseded while waiting for the old apply never starts', async () => {
  const applying = Promise.withResolvers<void>();
  const replies = [['camera', 'microphone'], ['microphone'], ['camera']];
  let reads = 0;
  const applied: string[] = [];
  const receipts: string[] = [];
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: 3,
    api: {
      admit: async () => admission,
      reconcile: async () => {
        const publish = reads === 0 ? [] : replies[reads - 1];
        reads++;
        return { ...snapshot, grants: { ...snapshot.grants, publish } };
      },
    },
    transport: () =>
      transport({
        apply: async (state) => {
          applied.push(state.grants.publish.join('+'));
          if (applied.length === 2) await applying.promise;
        },
      }),
    changed: () => undefined,
    received: (state) => receipts.push(state.grants.publish.join('+')),
  });
  await controller.join();
  receipts.length = 0;
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  void controller.reconcile(version(4));
  await settle();
  void controller.reconcile(version(5));
  await settle();
  const held = [reads, [...applied]];
  applying.resolve();
  await pending;
  await settle();
  assert({
    given: 'two newer views while an old SDK apply is still running',
    should:
      'read fresh for both, skip the superseded queued apply, and apply and announce only the last',
    actual: [held, applied, receipts],
    expected: [
      [4, ['', 'camera+microphone']],
      ['', 'camera+microphone', 'camera'],
      ['camera'],
    ],
  });
  controller.stop();
});

test('a receipt superseded in any microtask gap after apply is never announced', async () => {
  const results = new Set<string>();
  for (let gap = 0; gap < 12; gap++) {
    const applying = Promise.withResolvers<void>();
    const receipts: string[] = [];
    let applies = 0;
    let reads = 0;
    const controller = createMediaController({
      roundId,
      initialRoundViewVersion: 3,
      api: {
        admit: async () => admission,
        reconcile: async () => {
          reads++;
          return {
            ...snapshot,
            grants: {
              ...snapshot.grants,
              publish: reads === 2 ? ['microphone'] : ['camera'],
            },
          };
        },
      },
      transport: () =>
        transport({
          apply: async () => {
            if (++applies === 2) await applying.promise;
          },
        }),
      changed: () => undefined,
      received: (state) => receipts.push(state.grants.publish.join('+')),
    });
    await controller.join();
    receipts.length = 0;
    const pending = controller.reconcile({ kind: 'wake' });
    await settle();
    applying.resolve();
    for (let tick = 0; tick < gap; tick++) await Promise.resolve();
    const announced = receipts.length > 0;
    void controller.reconcile(version(4));
    await pending;
    await settle();
    // A receipt delivered before the view arrived was still current.
    if (!announced) results.add(receipts.join());
    controller.stop();
  }
  assert({
    given: 'a newer view landing in each microtask gap after an apply settles',
    should: 'announce only the fresh reply unless the old one already was',
    actual: [...results],
    expected: ['camera'],
  });
});
