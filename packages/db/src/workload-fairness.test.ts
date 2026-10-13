import { AsyncLocalStorage } from 'node:async_hooks';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createWorkloadExecutor } from './workload-admission';
import { deferred, manualTimers } from './workload-executor.test-support';

setupRitewayBun();
const oneSlotControl = (fairnessKey?: () => string | undefined) =>
  createWorkloadExecutor(
    { control: 1 },
    {
      queues: { control: { depth: 8, maxWaitMs: 5_000 } },
      timers: manualTimers().timers,
      ...(fairnessKey ? { fairnessKey } : {}),
    },
  );

/** Holds the only slot and queues three operations that record `n` when they run. */
const queueThreeBehindHeld = (
  executor: ReturnType<typeof oneSlotControl>,
  record: (n: number) => void,
) => {
  const held = deferred();
  const running = executor.run('control', () => held.promise);
  const waiting = [1, 2, 3].map((n) =>
    executor.run('control', async () => record(n)),
  );
  return {
    waiting,
    drain: async () => {
      held.resolve();
      await running;
      await Promise.all(waiting);
    },
  };
};

test('a saturated lane serves waiting callers round-robin, so one flooding key cannot starve another', async () => {
  let key = 'flood';
  const executor = oneSlotControl(() => key);
  const order: string[] = [];
  const { waiting, drain } = queueThreeBehindHeld(executor, (n) =>
    order.push(`flood-${n}`),
  );
  key = 'real';
  waiting.push(
    executor.run('control', async () => {
      order.push('real');
    }),
  );
  await drain();
  assert({
    given: 'three queued flood operations, then one from another caller',
    should: 'grant the other caller the second slot instead of the fourth',
    actual: order,
    expected: ['flood-1', 'real', 'flood-2', 'flood-3'],
  });
});

test('callers without a fairness key share one FIFO queue', async () => {
  const executor = oneSlotControl();
  const order: number[] = [];
  await queueThreeBehindHeld(executor, (n) => order.push(n)).drain();
  assert({
    given: 'three queued operations with no fairness key',
    should: 'run them in arrival order',
    actual: order,
    expected: [1, 2, 3],
  });
});

test('queued work runs in its own caller context, not the context of the work that freed its slot', async () => {
  const scope = new AsyncLocalStorage<string>();
  const executor = oneSlotControl(() => scope.getStore());
  const held = deferred();
  const running = scope.run('203.0.113.0/24', () =>
    executor.run('control', async () => {
      await held.promise;
    }),
  );
  const seen = scope.run('198.51.100.0/24', () =>
    executor.run('control', async () => scope.getStore()),
  );
  held.resolve();
  await running;
  assert({
    given:
      'work queued by one client network while another network holds the only slot',
    should: 'run with the queuing network as its fairness key',
    actual: await seen,
    expected: '198.51.100.0/24',
  });
});
