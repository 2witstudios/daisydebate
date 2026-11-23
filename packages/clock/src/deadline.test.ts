import { assert, setupRitewayBun, test } from 'riteway/bun';
import { afterMs, deadlineSignal } from './deadline';
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

test('a one-shot runs once when due, and never once cancelled', async () => {
  const clock = virtualClock();
  const ran: number[] = [];
  afterMs(clock, 100, () => ran.push(clock.nowMs()));
  const cancel = afterMs(clock, 50, () => ran.push(-1));
  cancel();
  await clock.advance(500);
  assert({
    given: 'a 100 ms one-shot and a 50 ms one cancelled at once',
    should: 'run the first at 100 only, the second never, and leave no wait',
    actual: { ran, sleepers: clock.sleepers() },
    expected: { ran: [100], sleepers: 0 },
  });
});
