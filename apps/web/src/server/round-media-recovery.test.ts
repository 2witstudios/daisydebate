import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRoundMediaRecovery } from './round-media-recovery';
setupRitewayBun();
test('media recovery schedules independently every 500 ms and stops before resources close', async () => {
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
  await Promise.resolve();
  const stopping = service.stop().then(() => {
    closed = true;
  });
  assert({
    given: 'recovery remains in flight while its timer ticks twice',
    should:
      'start each tick anyway at 500 ms, stop its timer immediately and await every tick',
    actual: [calls, period, timerStopped, closed],
    expected: [3, 500, true, false],
  });
  gate.resolve();
  await stopping;
  tick();
  assert({
    given: 'shutdown awaited the provider work',
    should: 'never restart recovery',
    actual: [calls, closed],
    expected: [3, true],
  });
});
