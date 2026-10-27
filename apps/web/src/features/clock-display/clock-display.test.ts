import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { formatCountdown, formatSeconds } from './clock-display';

setupRitewayBun();

describe('formatSeconds', () => {
  test('a duration in seconds', () => {
    assert({
      given: '14, 108, 600 and 440 seconds',
      should: 'read as minutes and two-digit seconds',
      actual: [14, 108, 600, 440].map(formatSeconds),
      expected: ['0:14', '1:48', '10:00', '7:20'],
    });
    assert({
      given: 'a fraction of a second and a negative duration',
      should: 'drop the fraction and never read below zero',
      actual: [59.9, -5].map(formatSeconds),
      expected: ['0:59', '0:00'],
    });
  });
});

describe('formatCountdown', () => {
  test('time remaining in milliseconds', () => {
    assert({
      given: 'a running clock with 1ms left',
      should: 'still show 0:01',
      actual: formatCountdown(1),
      expected: '0:01',
    });
    assert({
      given: 'exactly zero',
      should: 'show 0:00',
      actual: formatCountdown(0),
      expected: '0:00',
    });
    assert({
      given: 'four minutes and a fraction, and 59 001 ms',
      should: 'round the fraction up',
      actual: [formatCountdown(240_001), formatCountdown(59_001)],
      expected: ['4:01', '1:00'],
    });
    assert({
      given: 'an overrun clock',
      should: 'clamp to 0:00',
      actual: formatCountdown(-5_000),
      expected: '0:00',
    });
  });
});
