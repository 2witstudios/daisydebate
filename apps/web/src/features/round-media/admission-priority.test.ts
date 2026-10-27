import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAdmissionPriority } from './admission-priority';
import { createRoundMediaOperations } from './operations';
import { createMediaWorld, fixedId } from './media-world.test-support';
setupRitewayBun();
test('Redis-down fairness degrades once and leaves canonical admission available', async () => {
  const world = createMediaWorld();
  const events: string[] = [];
  const priority = createAdmissionPriority({
    hint: async () => {
      throw Error('offline');
    },
    logger: {
      log: (event) => {
        events.push(event);
      },
      child: () => world.input.logger,
    },
  });
  const admission = await createRoundMediaOperations({
    ...world.input,
    priority,
  }).session(world.roundId, world.seats[0].actorId);
  assert({
    given: 'Redis unavailable at waiter entry and release',
    should: 'still reconcile and admit with one classified degraded event',
    actual: [admission.state, events],
    expected: ['ready', ['round.media.fairness_degraded']],
  });
});
test('another web instance yields its recovery claim to an admission already waiting', async () => {
  const world = createMediaWorld();
  const waiting = new Set<string>();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const observed = Promise.withResolvers<string>();
  let first = true;
  const store = {
    ...world.input.store,
    claimMediaReconcile: async (request: {
      sessionId: string;
      owner: string;
    }) => {
      if (first) {
        first = false;
        return { kind: 'wait' as const, retryAt: '2026-10-22T00:00:00.000Z' };
      }
      if (!waiting.has(request.owner)) observed.resolve('recovery-claimed');
      return world.input.store.claimMediaReconcile(request);
    },
  };
  const shared = {
    ...world.input,
    store,
    wait: () => release.promise,
    priority: async (_id: string, operation: string, owner?: string) => {
      if (operation === 'enter') {
        waiting.add(owner!);
        entered.resolve();
      }
      if (operation === 'leave') waiting.delete(owner!);
      if (operation === 'waiting' && waiting.size > 0)
        observed.resolve('recovery-yielded');
      return waiting.size > 0;
    },
  };
  const admitted = createRoundMediaOperations(shared).holdForCapture(
    fixedId('session'),
    async () => 'issued',
  );
  await entered.promise;
  const recovering = createRoundMediaOperations(shared).reconcile(
    world.roundId,
  );
  try {
    assert({
      given:
        'an admission queued behind a reconcile lease and another web instance recovering',
      should: 'yield the next claim so the admission itself performs recovery',
      actual: await observed.promise,
      expected: 'recovery-yielded',
    });
  } finally {
    release.resolve();
    await Promise.all([admitted, recovering]);
  }
});
