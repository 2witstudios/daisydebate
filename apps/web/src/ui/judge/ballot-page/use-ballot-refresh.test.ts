import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotRefreshEveryMs } from '../../../features/round-ballots/ballot-refresh';
import { refreshWhileKept } from './use-ballot-refresh';

setupRitewayBun();

/** One interval at most, advanced by hand. */
const manualTimers = () => {
  let run: (() => void) | null = null;
  const periods: number[] = [];
  return {
    periods,
    running: () => run !== null,
    tick: () => run?.(),
    timers: {
      setInterval: (callback: () => void, everyMs: number) => {
        run = callback;
        periods.push(everyMs);
        return periods.length;
      },
      clearInterval: () => {
        run = null;
      },
    },
  };
};

const started = (stopsAtMs: number) => {
  const clock = manualTimers();
  let nowMs = 0;
  let refreshes = 0;
  const stop = refreshWhileKept({
    keeps: (at) => at < stopsAtMs,
    nowMs: () => nowMs,
    refresh: () => (refreshes += 1),
    timers: clock.timers,
  });
  const pass = (intervals: number) => {
    for (let passed = 0; passed < intervals; passed += 1) {
      nowMs += ballotRefreshEveryMs;
      clock.tick();
    }
    return refreshes;
  };
  return { clock, pass, stop };
};

test('refreshing runs until the page no longer keeps it', () => {
  const { clock, pass } = started(3 * ballotRefreshEveryMs);
  assert({
    given:
      'a page kept refreshing for three intervals, with no new props in that time',
    should:
      'refresh on the first two, stop itself at the third and never refresh again',
    actual: [clock.periods, pass(2), clock.running(), pass(3), clock.running()],
    expected: [[ballotRefreshEveryMs], 2, true, 2, false],
  });
});

test('a page that is not kept refreshing starts no timer', () => {
  const { clock, pass } = started(0);
  assert({
    given: 'a page that does not keep refreshing when it mounts',
    should: 'start no timer and never refresh',
    actual: [clock.periods, pass(2)],
    expected: [[], 0],
  });
});

test('leaving the page stops the refreshing', () => {
  const { clock, pass, stop } = started(Number.POSITIVE_INFINITY);
  const before = pass(1);
  stop();
  assert({
    given: 'a refreshing page that is left',
    should: 'refresh no more',
    actual: [before, clock.running(), pass(2)],
    expected: [1, false, 1],
  });
});
