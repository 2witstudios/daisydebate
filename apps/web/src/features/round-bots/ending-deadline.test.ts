import { assert, setupRitewayBun, test } from 'riteway/bun';
import { endingDeadline } from './ending-deadline';
setupRitewayBun();

function manualTimer() {
  const armed = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  return {
    armed,
    timer: {
      setTimeout: (run: () => void, ms: number) => {
        armed.set(++next, { run, ms });
        return next;
      },
      clearTimeout: (handle: unknown) => {
        armed.delete(handle as number);
      },
    },
  };
}

test('a seat’s ending deadline trips two renewals inside its lease (ISSUE-789)', async () => {
  const { armed, timer } = manualTimer();
  const deadline = endingDeadline(
    { leaseMs: 15000, renewMs: 3000 },
    timer,
  )(new AbortController().signal);
  const [only] = [...armed.values()];
  only!.run();
  await deadline;
  assert({
    given: 'a 15 s lease renewed every 3 s',
    should: 'arm one 9 s timer and settle when it fires',
    actual: only!.ms,
    expected: 9000,
  });
});

test('an ending that finishes clears its deadline timer (ISSUE-789)', () => {
  const { armed, timer } = manualTimer();
  const done = new AbortController();
  void endingDeadline({ leaseMs: 15000, renewMs: 3000 }, timer)(done.signal);
  done.abort();
  assert({
    given: 'an ending that settled before its deadline',
    should: 'leave no timer armed',
    actual: armed.size,
    expected: 0,
  });
});
