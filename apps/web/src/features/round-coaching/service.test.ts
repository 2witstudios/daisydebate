import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRoundCoachingService } from './service';

setupRitewayBun();

const manualTimers = () => {
  const tasks: (() => Promise<void>)[] = [];
  return {
    tick: () => Promise.all(tasks.map((task) => task())),
    timers: {
      setInterval: (task: () => Promise<void>, _ms: number) => tasks.push(task),
      clearInterval: () => {
        tasks.length = 0;
      },
    },
  };
};
const limits = { parallel: 2, scanBatch: 8, scanMs: 100 };

test('each scan starts at most `parallel` coaching calls and none twice', async () => {
  const started: string[] = [];
  const release: (() => void)[] = [];
  const { tick, timers } = manualTimers();
  const service = startRoundCoachingService({
    scan: async () => ['a', 'b', 'c'],
    coach: (roundId) => {
      started.push(roundId);
      return new Promise<void>((resolve) => release.push(resolve));
    },
    limits,
    timers,
    failed: () => undefined,
  });
  await service.started;
  await tick();
  const whileBusy = [...started];
  release.forEach((done) => done());
  await service.stop();
  started.length = 0;
  const again = startRoundCoachingService({
    scan: async () => ['c'],
    coach: async (roundId) => {
      started.push(roundId);
    },
    limits,
    timers,
    failed: () => undefined,
  });
  await again.started;
  await tick();
  await again.stop();
  assert({
    given: 'three Rounds needing coaching, a parallel limit of two',
    should:
      'start two and none again while they run; a later scan picks up the rest, every scan',
    actual: { whileBusy, after: started },
    expected: { whileBusy: ['a', 'b'], after: ['c', 'c'] },
  });
});

test('a full provider waits; other failures are reported', async () => {
  const failures: [string, string][] = [];
  const { timers } = manualTimers();
  const service = startRoundCoachingService({
    scan: async () => ['busy', 'broken'],
    coach: async (roundId) => {
      throw roundId === 'busy'
        ? createAppError('CONFLICT', 'Provider capacity unavailable')
        : createAppError('INFRASTRUCTURE', 'The coach answered malformed JSON');
    },
    limits,
    timers,
    failed: (error, stage) => failures.push([stage, (error as Error).message]),
  });
  await service.started;
  await service.stop();
  assert({
    given: 'one Round refused for capacity and one whose call failed',
    should: 'report only the failed call',
    actual: failures,
    expected: [['coach', 'The coach answered malformed JSON']],
  });
});
