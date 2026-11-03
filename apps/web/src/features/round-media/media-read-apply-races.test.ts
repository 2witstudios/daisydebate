import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  admission,
  readHarness,
  snapshot,
  viewAt,
  heldSecondRead,
  holdingSecondApply,
  wakeAfterJoin,
} from './media-fixtures.test-support';
import { settle } from './adapters/livekit-room.test-support';
setupRitewayBun();

test('a reply superseded in any microtask gap never ends or fails its successor', async () => {
  const results = new Set<string>();
  for (const late of [
    { ...snapshot, state: 'ended' },
    { ...snapshot, roundId: 'x'.repeat(24) },
    { ...snapshot, state: 'unavailable' },
  ])
    for (let gap = 0; gap < 12; gap++) {
      const { held, controller, pending, stops } = await heldSecondRead();
      held.resolve(late);
      for (let tick = 0; tick < gap; tick++) await Promise.resolve();
      // A reply already acted on is not obsolete; only a live connection counts.
      if (controller.state() === 'live' && stops() === 0) {
        void controller.reconcile(viewAt(4));
        await pending;
        await settle();
        results.add(`${controller.state()}:${stops()}`);
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

test('a receipt superseded in any microtask gap after apply is never announced', async () => {
  const results = new Set<string>();
  for (let gap = 0; gap < 12; gap++) {
    const applying = Promise.withResolvers<void>();
    const receipts: string[] = [];
    let reads = 0;
    const controller = readHarness({
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
      transport: holdingSecondApply(applying.promise),
      received: (state) => receipts.push(state.grants.publish.join('+')),
    });
    const { pending } = await wakeAfterJoin(controller, receipts);
    applying.resolve();
    for (let tick = 0; tick < gap; tick++) await Promise.resolve();
    const announced = receipts.length > 0;
    void controller.reconcile(viewAt(4));
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
