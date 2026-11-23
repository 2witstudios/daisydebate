import { assert, setupRitewayBun, test } from 'riteway/bun';
import { deadlineSignal, withDeadline } from './deadline';
import { virtualClock } from './testing';

setupRitewayBun();

test('a deadline aborts with a TimeoutError when its time passes', async () => {
  const clock = virtualClock();
  const deadline = deadlineSignal(clock, 100);
  await clock.advance(99);
  const before = deadline.signal.aborted;
  await clock.advance(1);
  assert({
    given: 'a 100 ms deadline',
    should:
      'abort at 100 ms, not before, with the reason AbortSignal.timeout gives',
    actual: {
      before,
      after: deadline.signal.aborted,
      reason: (deadline.signal.reason as DOMException).name,
      sleepers: clock.sleepers(),
    },
    expected: {
      before: false,
      after: true,
      reason: 'TimeoutError',
      sleepers: 0,
    },
  });
});

test('a cleared deadline never aborts and leaves no wait', async () => {
  const clock = virtualClock();
  const deadline = deadlineSignal(clock, 100);
  deadline.clear();
  await clock.settle();
  const sleepers = clock.sleepers();
  await clock.advance(500);
  assert({
    given: 'a deadline cleared before it passes',
    should: 'leave no sleeper and never abort',
    actual: { sleepers, aborted: deadline.signal.aborted },
    expected: { sleepers: 0, aborted: false },
  });
});

test('a parent that aborts first ends the deadline with its own reason', async () => {
  const clock = virtualClock();
  const stop = new AbortController();
  const deadline = deadlineSignal(clock, 100, stop.signal);
  stop.abort(new Error('stopping'));
  await clock.settle();
  assert({
    given: 'a parent signal aborted before the deadline',
    should: 'abort with the parent reason and leave no wait',
    actual: {
      reason: (deadline.signal.reason as Error).message,
      sleepers: clock.sleepers(),
    },
    expected: { reason: 'stopping', sleepers: 0 },
  });
});

test('withDeadline rejects a slow operation and passes a fast one through', async () => {
  const clock = virtualClock();
  let sawAbort = false;
  const slow = withDeadline(clock, 100, async (signal) => {
    await clock.sleep(1_000, signal);
    sawAbort = signal.aborted;
    return 'late';
  }).catch((error: DOMException) => error.name);
  const fast = withDeadline(clock, 100, async () => {
    await clock.sleep(10);
    return 'on time';
  });
  await clock.advance(200);
  assert({
    given:
      'an operation that takes 1 s and one that takes 10 ms, each bounded at 100 ms',
    should:
      'reject the slow one with a TimeoutError, aborting it, and resolve the fast one',
    actual: {
      slow: await slow,
      sawAbort,
      fast: await fast,
      sleepers: clock.sleepers(),
    },
    expected: {
      slow: 'TimeoutError',
      sawAbort: true,
      fast: 'on time',
      sleepers: 0,
    },
  });
});
