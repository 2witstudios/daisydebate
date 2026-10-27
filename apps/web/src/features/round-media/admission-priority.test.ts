import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAdmissionPriority } from './admission-priority';
import { createRoundMediaOperations } from './operations';
import { createMediaWorld, fixedId } from './media-world.test-support';
setupRitewayBun();
test('Redis-down fairness degrades once and leaves canonical admission available', async () => {
  const world = createMediaWorld();
  const events: string[] = [];
  const priority = createAdmissionPriority({
    deadline: (work) => work,
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
test('a stalled Redis hint cannot hold admission or recovery beyond its injected deadline', async () => {
  const world = createMediaWorld();
  const events: string[] = [],
    operations: string[] = [];
  const priority = createAdmissionPriority({
    hint: async (_session, operation) => {
      operations.push(operation);
      return new Promise<boolean>(() => {});
    },
    deadline: async () => {
      throw new Error('Hint deadline');
    },
    logger: {
      log: (event) => {
        events.push(event);
      },
      child: () => world.input.logger,
    },
  });
  const media = createRoundMediaOperations({ ...world.input, priority });
  const admitted = await media.session(world.roundId, world.seats[0].actorId);
  await media.reconcile(world.roundId);
  assert({
    given: 'Redis connected but never responding to enter, leave or waiting',
    should:
      'bound every optional wait, admit and recover canonically, and report one degraded episode',
    actual: [admitted.state, operations, events],
    expected: [
      'ready',
      ['enter', 'leave', 'waiting'],
      ['round.media.fairness_degraded'],
    ],
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
