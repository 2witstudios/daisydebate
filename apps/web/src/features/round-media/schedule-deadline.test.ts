import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTimerQueue } from '../realtime/connection-store.test-support';
import { createRoundTime } from '../round-runtime/round-time';
import { scheduleMediaDeadline } from './schedule-deadline';
setupRitewayBun();
test('same-view calibration re-arms the actual media boundary and disposal cancels it', () => {
  const scheduler = createTimerQueue((now, ms) => now + ms);
  const roundTime = createRoundTime({
    monotonicNowMs: scheduler.now,
    hydrationSeedServerMs: 10000,
  });
  let refreshes = 0;
  const stop = scheduleMediaDeadline({
    deadlineMs: 20000,
    roundTime,
    scheduler,
    refresh: () => refreshes++,
  });
  scheduler.advance(1000);
  roundTime.sample({
    serverNowMs: 15000,
    sentAtMs: 1000,
    receivedAtMs: 1000,
    generation: 1,
  });
  scheduler.advance(4999);
  assert({
    given: 'an unchanged Round whose clock was corrected ahead',
    should: 'hold until the corrected boundary',
    actual: refreshes,
    expected: 0,
  });
  scheduler.advance(1);
  assert({
    given: 'the corrected boundary at monotonic 6000 rather than 10000',
    should: 'refresh once with the shared display time',
    actual: [refreshes, roundTime.nowMs()],
    expected: [1, 20000],
  });
  scheduler.advance(10000);
  stop();
  const cancel = scheduleMediaDeadline({
    deadlineMs: 40000,
    roundTime,
    scheduler,
    refresh: () => refreshes++,
  });
  cancel();
  scheduler.advance(20000);
  assert({
    given: 'a disposed boundary owner',
    should: 'leave no timers or subscriptions that refresh later',
    actual: [refreshes, scheduler.pending()],
    expected: [1, 0],
  });
});
