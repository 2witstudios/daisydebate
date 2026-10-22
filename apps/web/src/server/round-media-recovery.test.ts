import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRoundMediaRecovery } from './round-media-recovery';
setupRitewayBun();
test('media recovery schedules independently every500ms and stops before resources close', async () => {
  const gate = Promise.withResolvers<void>();
  let tick: () => void = () => {},
    period = 0,
    calls = 0,
    timerStopped = false,
    closed = false;
  const service = startRoundMediaRecovery({
    recover: async () => {
      calls++;
      await gate.promise;
    },
    failed: () => {
      throw Error('unexpected');
    },
    every: (ms, work) => {
      period = ms;
      tick = work;
      return {
        stop: () => {
          timerStopped = true;
        },
      };
    },
  });
  await Promise.resolve();
  tick();
  tick();
  const stopping = service.stop().then(() => {
    closed = true;
  });
  assert({
    given: 'recovery remains in flight while its timer ticks twice',
    should:
      'run once at500ms, stop its timer immediately and await actual work',
    actual: [calls, period, timerStopped, closed],
    expected: [1, 500, true, false],
  });
  gate.resolve();
  await stopping;
  tick();
  assert({
    given: 'shutdown awaited the provider work',
    should: 'never restart recovery',
    actual: [calls, closed],
    expected: [1, true],
  });
});
