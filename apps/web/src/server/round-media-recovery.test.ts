import { assert, setupRitewayBun, test } from 'riteway/bun';
import { manualTimers } from '../lib/worker-timers.test-support';
import { startRoundMediaRecovery } from './round-media-recovery';
setupRitewayBun();

test('a pass waits only for the session list, so a slow Round holds only itself', async () => {
  const gate = Promise.withResolvers<void>();
  const { tasks, timers, waits } = manualTimers();
  let calls = 0;
  let closed = false;
  const service = startRoundMediaRecovery({
    recover: async (listed) => {
      calls++;
      listed(['round']);
      await gate.promise;
    },
    failed: () => {
      throw Error('unexpected');
    },
    timers,
  });
  await service.started;
  await tasks.get(500)!();
  const stopping = service.stop().then(() => {
    closed = true;
  });
  await Promise.resolve();
  assert({
    given: 'recovery still in flight with a live session',
    should:
      'start the next pass at 500 ms anyway, and stop only after every pass',
    actual: [calls, waits, closed],
    expected: [2, [500, 500], false],
  });
  gate.resolve();
  await stopping;
  assert({
    given: 'shutdown awaited the recovery work',
    should: 'arm nothing more',
    actual: [calls, tasks.size, closed],
    expected: [2, 0, true],
  });
});

test('no live media session backs recovery off', async () => {
  const { tasks, timers, waits } = manualTimers();
  const service = startRoundMediaRecovery({
    recover: async (listed) => listed([]),
    failed: () => {
      throw Error('unexpected');
    },
    timers,
  });
  await service.started;
  await tasks.get(500)!();
  await tasks.get(1000)!();
  await service.stop();
  assert({
    given: 'three passes that list no session',
    should: 'wait longer before each next pass',
    actual: waits,
    expected: [500, 1000, 2000],
  });
});

test('a failed list is reported and backs off', async () => {
  const { tasks, timers, waits } = manualTimers();
  const failures: unknown[] = [];
  const outage = new Error('list failed');
  const service = startRoundMediaRecovery({
    recover: async () => {
      throw outage;
    },
    failed: (error) => failures.push(error),
    timers,
  });
  await service.started;
  await tasks.get(500)!();
  await service.stop();
  assert({
    given: 'two passes whose list fails',
    should: 'report each and grow the wait',
    actual: { failures, waits },
    expected: { failures: [outage, outage], waits: [500, 1000] },
  });
});

test("the probe's live Round alone is no work for media recovery", async () => {
  const { tasks, timers, waits } = manualTimers();
  const service = startRoundMediaRecovery({
    recover: async (listed) => listed(['probe']),
    probeRoundId: 'probe',
    failed: () => {
      throw Error('unexpected');
    },
    timers,
  });
  await service.started;
  await tasks.get(500)!();
  await service.stop();
  assert({
    given: 'only the availability probe Round with a live media session',
    should: 'back off as idle',
    actual: waits,
    expected: [500, 1000],
  });
});
