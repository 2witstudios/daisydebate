import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRoundAnalysisService } from './service';

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
const seat = (roundParticipantId: string) => ({
  roundId: `round-${roundParticipantId}`,
  roundParticipantId,
});

test('each scan starts at most `parallel` coaching calls and none twice', async () => {
  const started: string[] = [];
  const release: (() => void)[] = [];
  const { tick, timers } = manualTimers();
  const service = startRoundAnalysisService({
    scan: async () => ['a', 'b', 'c'].map(seat),
    analyse: ({ roundParticipantId }) => {
      started.push(roundParticipantId);
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
  const again = startRoundAnalysisService({
    scan: async () => [seat('c')],
    analyse: async ({ roundParticipantId }) => {
      started.push(roundParticipantId);
    },
    limits,
    timers,
    failed: () => undefined,
  });
  await again.started;
  await tick();
  await again.stop();
  assert({
    given: 'three seats needing an analysis, a parallel limit of two',
    should:
      'start two and none again while they run; a later scan picks up the rest, every scan',
    actual: { whileBusy, after: started },
    expected: { whileBusy: ['a', 'b'], after: ['c', 'c'] },
  });
});

test('a full provider waits; other failures are reported', async () => {
  const failures: [string, string][] = [];
  const { timers } = manualTimers();
  const service = startRoundAnalysisService({
    scan: async () => ['busy', 'broken'].map(seat),
    analyse: async ({ roundParticipantId }) => {
      throw roundParticipantId === 'busy'
        ? createAppError('CONFLICT', 'Provider capacity unavailable')
        : createAppError(
            'INFRASTRUCTURE',
            'The analyst answered malformed JSON',
          );
    },
    limits,
    timers,
    failed: (error, stage) => failures.push([stage, (error as Error).message]),
  });
  await service.started;
  await service.stop();
  assert({
    given: 'one seat refused for capacity and one whose call failed',
    should: 'report only the failed call',
    actual: failures,
    expected: [['analyse', 'The analyst answered malformed JSON']],
  });
});
