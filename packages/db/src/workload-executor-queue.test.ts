import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  createWorkloadExecutor,
  workloadCapacities,
  workloadQueueOptions,
} from './workload-admission';
import { workloadDatabase } from './workload-executor';
import { deferred } from './workload-executor.test-support';

setupRitewayBun();

/** Manual timers: waits expire only when the test fires them. */
const manualTimers = () => {
  const pending = new Map<number, () => void>();
  let next = 0;
  return {
    timers: {
      setTimeout: (callback: () => void) => {
        pending.set(++next, callback);
        return next;
      },
      clearTimeout: (id: number) => void pending.delete(id),
    },
    fire: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    size: () => pending.size,
  };
};

test('saturated work waits in a bounded FIFO queue and receives settled slots in order', async () => {
  const clock = manualTimers();
  const executor = createWorkloadExecutor(
    { control: 1 },
    { queues: { control: 2 }, maxWaitMs: 1_000, timers: clock.timers },
  );
  const held = deferred();
  const order: string[] = [];
  const running = executor.run('control', async () => {
    await held.promise;
    order.push('first');
  });
  const second = executor.run('control', async () => order.push('second'));
  const third = executor.run('control', async () => order.push('third'));
  await assertRejects({
    given: 'a full lane and a full wait queue',
    should: 'refuse the next operation without running it',
    actual: () => executor.run('control', async () => order.push('refused')),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'queued operations behind running work',
    should: 'not start before a slot settles',
    actual: order,
    expected: [],
  });
  held.resolve();
  await Promise.all([running, second, third]);
  assert({
    given: 'the running operation settled',
    should: 'hand slots to waiters in arrival order and clear their timers',
    actual: { order, timers: clock.size() },
    expected: { order: ['first', 'second', 'third'], timers: 0 },
  });
});

test('a waiter that reaches its age bound is refused and never runs', async () => {
  const clock = manualTimers();
  const executor = createWorkloadExecutor(
    { social: 1 },
    { queues: { social: 1 }, maxWaitMs: 1_000, timers: clock.timers },
  );
  const held = deferred();
  let ran = false;
  const running = executor.run('social', () => held.promise);
  const waiting = executor.run('social', async () => {
    ran = true;
  });
  clock.fire();
  await assertRejects({
    given: 'a queued operation whose wait expired',
    should: 'refuse as unavailable capacity',
    actual: () => waiting,
    code: 'INFRASTRUCTURE',
  });
  held.resolve();
  await running;
  assert({
    given: 'the slot released after the waiter expired',
    should: 'never run the expired work and admit the next operation',
    actual: { ran, next: await executor.run('social', async () => 'next') },
    expected: { ran: false, next: 'next' },
  });
});

test('a lazy statement on a saturated lane defers its builder until it holds a slot', async () => {
  const clock = manualTimers();
  const executor = createWorkloadExecutor(
    { competitive: 1 },
    { queues: { competitive: 1 }, maxWaitMs: 1_000, timers: clock.timers },
  );
  const held = deferred();
  let built = 0;
  const raw = {
    select: () => {
      built++;
      return {
        from: (table: string) => ({
          then: (resolve: (value: string) => unknown) => resolve(table),
        }),
      };
    },
  };
  const database = workloadDatabase(raw, executor, 'competitive');
  const running = executor.run('competitive', () => held.promise);
  const reading = Promise.resolve(database.select().from('rows'));
  await Promise.resolve();
  assert({
    given: 'a saturated lane with queue room',
    should: 'not invoke the raw builder before a slot is granted',
    actual: built,
    expected: 0,
  });
  held.resolve();
  await running;
  assert({
    given: 'the slot granted to the deferred statement',
    should: 'replay the builder chain once and resolve its result',
    actual: { result: await reading, built },
    expected: { result: 'rows', built: 1 },
  });
});

test('runtime lanes queue a bounded multiple of their capacity for a bounded age', () => {
  const capacities = workloadCapacities('web', 12);
  assert({
    given: 'the web profile on a 12-connection pool',
    should: 'queue sixteen waiters per reserved slot for at most two seconds',
    actual: workloadQueueOptions(capacities),
    expected: {
      queues: {
        control: 32,
        competitive: 64,
        social: 48,
        search: 16,
        admission: 32,
      },
      maxWaitMs: 2_000,
    },
  });
});
