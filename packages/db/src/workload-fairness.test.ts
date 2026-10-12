import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createWorkloadExecutor } from './workload-admission';
import { deferred, manualTimers } from './workload-executor.test-support';

setupRitewayBun();

test('a saturated lane serves waiting callers round-robin, so one flooding key cannot starve another', async () => {
  const clock = manualTimers();
  let key = 'flood';
  const executor = createWorkloadExecutor(
    { control: 1 },
    {
      queues: { control: { depth: 8, maxWaitMs: 5_000 } },
      timers: clock.timers,
      fairnessKey: () => key,
    },
  );
  const order: string[] = [];
  const held = deferred();
  const running = executor.run('control', () => held.promise);
  const waiting = [1, 2, 3].map((n) =>
    executor.run('control', async () => {
      order.push(`flood-${n}`);
    }),
  );
  key = 'real';
  waiting.push(
    executor.run('control', async () => {
      order.push('real');
    }),
  );
  held.resolve();
  await running;
  await Promise.all(waiting);
  assert({
    given: 'three queued flood operations, then one from another caller',
    should: 'grant the other caller the second slot instead of the fourth',
    actual: order,
    expected: ['flood-1', 'real', 'flood-2', 'flood-3'],
  });
});

test('callers without a fairness key share one FIFO queue', async () => {
  const executor = createWorkloadExecutor(
    { control: 1 },
    {
      queues: { control: { depth: 8, maxWaitMs: 5_000 } },
      timers: manualTimers().timers,
    },
  );
  const order: number[] = [];
  const held = deferred();
  const running = executor.run('control', () => held.promise);
  const waiting = [1, 2, 3].map((n) =>
    executor.run('control', async () => {
      order.push(n);
    }),
  );
  held.resolve();
  await running;
  await Promise.all(waiting);
  assert({
    given: 'three queued operations with no fairness key',
    should: 'run them in arrival order',
    actual: order,
    expected: [1, 2, 3],
  });
});
