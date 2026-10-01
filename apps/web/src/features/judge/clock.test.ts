import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { formatClock, windowLabel } from './clock';

setupRitewayBun();

describe('formatClock', () => {
  test('seconds to minutes', () => {
    assert({
      given: '14, 108, 600 and negative seconds',
      should: 'read as minutes and two-digit seconds, never below zero',
      actual: [14, 108, 600, -5].map(formatClock),
      expected: ['0:14', '1:48', '10:00', '0:00'],
    });
  });
});

describe('windowLabel', () => {
  test('whole minutes and the rest', () => {
    assert({
      given: '120 and 90 seconds',
      should: 'say minutes when whole and seconds otherwise',
      actual: [windowLabel(120), windowLabel(90)],
      expected: ['2 min', '90 s'],
    });
  });
});
