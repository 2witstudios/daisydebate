import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createWorkloadExecutor } from './workload-admission';
import { deferred, manualTimers } from './workload-executor.test-support';

setupRitewayBun();

test('every refusal reports its lane and why, never silently', async () => {
  const clock = manualTimers();
  const refused: [string, string][] = [];
  const executor = createWorkloadExecutor(
    { control: 1 },
    {
      queues: { control: { depth: 1, maxWaitMs: 2_000 } },
      timers: clock.timers,
      onRefused: (lane, reason) => refused.push([lane, reason]),
    },
  );
  const held = deferred();
  const running = executor.run('control', () => held.promise);
  const aging = executor.run('control', async () => 'late').catch(() => 'aged');
  const full = await executor
    .run('control', async () => 'ran')
    .catch(() => 'full');
  clock.fire();
  const aged = await aging;
  held.resolve();
  await running;
  assert({
    given: 'a full queue and then a waiter that reaches its age',
    should: 'report one saturated and one expired refusal for the lane',
    actual: { outcomes: [full, aged], refused },
    expected: {
      outcomes: ['full', 'aged'],
      refused: [
        ['control', 'saturated'],
        ['control', 'expired'],
      ],
    },
  });
});
