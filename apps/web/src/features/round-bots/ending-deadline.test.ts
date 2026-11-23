import { assert, setupRitewayBun, test } from 'riteway/bun';
import { endingDeadline } from './ending-deadline';
import { manualWaits } from '../../lib/manual-waits.test-support';
setupRitewayBun();

test('a seat’s ending deadline trips two renewals inside its lease (ISSUE-789)', async () => {
  const { armed, tasks, waits } = manualWaits();
  const deadline = endingDeadline(
    { leaseMs: 15000, renewMs: 3000 },
    waits,
  )(new AbortController().signal);
  const [only] = armed;
  await tasks.get(only!)!();
  await deadline;
  assert({
    given: 'a 15 s lease renewed every 3 s',
    should: 'arm one 9 s timer and settle when it fires',
    actual: only,
    expected: 9000,
  });
});

test('an ending that finishes clears its deadline timer (ISSUE-789)', () => {
  const { tasks, waits } = manualWaits();
  const done = new AbortController();
  void endingDeadline({ leaseMs: 15000, renewMs: 3000 }, waits)(done.signal);
  done.abort();
  assert({
    given: 'an ending that settled before its deadline',
    should: 'leave no timer armed',
    actual: tasks.has(9000),
    expected: false,
  });
});
