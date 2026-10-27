import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  elapsedPercent,
  isTimeUp,
  pause,
  resume,
  startClock,
  tick,
} from './speech-clock';
import { formatCountdown } from '../clock-display/clock-display';

setupRitewayBun();

describe('speech clock', () => {
  test('counts down by the elapsed time', () => {
    assert({
      given: 'a five minute clock after 90 seconds',
      should: 'have 3:30 left',
      actual: formatCountdown(tick(startClock(300), 90_000).remainingMs),
      expected: '3:30',
    });
  });

  test('never goes below zero and then is up', () => {
    const state = tick(startClock(5), 60_000);
    assert({
      given: 'a clock that ran past its end',
      should: 'stop at zero and report time up',
      actual: [state.remainingMs, isTimeUp(state), isTimeUp(startClock(5))],
      expected: [0, true, false],
    });
  });

  test('a paused clock does not move until resumed', () => {
    const paused = pause(startClock(300));
    assert({
      given: 'ticks while paused and after resume',
      should: 'hold while paused and run after',
      actual: [
        tick(paused, 30_000).remainingMs,
        tick(resume(paused), 30_000).remainingMs,
      ],
      expected: [300_000, 270_000],
    });
  });

  test('a non-positive elapsed time changes nothing', () => {
    const state = startClock(60);
    assert({
      given: 'zero and negative elapsed time',
      should: 'return the same state',
      actual: [tick(state, 0) === state, tick(state, -5) === state],
      expected: [true, true],
    });
  });

  test('elapsed percent', () => {
    assert({
      given: 'a clock a quarter used, unstarted, and a zero-length speech',
      should: 'report 25, 0 and 100',
      actual: [
        elapsedPercent(100, tick(startClock(100), 25_000)),
        elapsedPercent(100, startClock(100)),
        elapsedPercent(0, startClock(0)),
      ],
      expected: [25, 0, 100],
    });
  });
});
