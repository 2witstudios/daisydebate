import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createWorkWakes } from './work-wakes';

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
