import { assert, setupRitewayBun, test } from 'riteway/bun';
import { manualWaits } from '../lib/manual-waits.test-support';
import { createWorkWakes, keepWorkWakesListening } from './work-wakes';

setupRitewayBun();

test('a wake reaches the loops that look for that kind of work', () => {
  const wakes = createWorkWakes();
  const woken: string[] = [];
  const stopJudging = wakes
    .of('judging')
    .subscribe(() => woken.push('judging'));
  wakes.of('round', 'analysis').subscribe(() => woken.push('live'));
  wakes.wake('judging');
  wakes.wake('analysis');
  stopJudging();
  wakes.wake('judging');
  assert({
    given: 'a judging wake, an analysis wake, then judging unsubscribed',
    should: 'wake each subscribed loop for its kinds only',
    actual: woken,
    expected: ['judging', 'live'],
  });
});

test('a re-established listen wakes every loop once', () => {
  const wakes = createWorkWakes();
  let woken = 0;
  wakes.of('round', 'judging').subscribe(() => {
    woken += 1;
  });
  wakes.of('analysis').subscribe(() => {
    woken += 1;
  });
  wakes.wakeAll();
  assert({
    given: 'two loops, one on two kinds',
    should: 'wake each loop exactly once',
    actual: woken,
    expected: 2,
  });
});

test('a LISTEN that cannot start is retried, doubling, until it holds', async () => {
  const time = manualWaits();
  const causes: string[] = [];
  let attempts = 0;
  let unlistened = 0;
  const listening = keepWorkWakesListening({
    subscribe: async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('connection refused');
      return {
        unlisten: async () => {
          unlistened += 1;
        },
      };
    },
    unavailable: (cause) => causes.push(cause),
    waits: time.waits,
  });
  await time.nextPass();
  await time.nextPass();
  await listening.stop();
  assert({
    given: 'two failed subscribes, then one that holds, then a stop',
    should: 'report each failure by class, retry at 1 s then 2 s, and unlisten',
    actual: { attempts, causes, waits: time.armed, unlistened },
    expected: {
      attempts: 3,
      causes: ['TypeError', 'TypeError'],
      waits: [1_000, 2_000],
      unlistened: 1,
    },
  });
});
