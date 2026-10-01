import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { barWidthClass, formatElapsed, secondsLeft } from './seconds';

setupRitewayBun();

describe('formatElapsed', () => {
  test('minutes and padded seconds', () => {
    assert({
      given: '0, 7, 60 and 125 seconds',
      should: 'read 0:00, 0:07, 1:00 and 2:05',
      actual: [0, 7, 60, 125].map(formatElapsed),
      expected: ['0:00', '0:07', '1:00', '2:05'],
    });
  });
});

describe('secondsLeft', () => {
  test('counts down and stops at zero', () => {
    assert({
      given: 'a 20 second countdown at 0, 6 and 25 seconds',
      should: 'leave 20, 14 and 0',
      actual: [0, 6, 25].map((elapsed) => secondsLeft(20, elapsed)),
      expected: [20, 14, 0],
    });
  });
});

describe('barWidthClass', () => {
  test('full, partial and empty', () => {
    assert({
      given: 'a 20 second countdown with 20, 11, 1, 0 and a bad total',
      should: 'round up to a tenth, and never leave the scale',
      actual: [
        barWidthClass(20, 20),
        barWidthClass(11, 20),
        barWidthClass(1, 20),
        barWidthClass(0, 20),
        barWidthClass(5, 0),
        barWidthClass(99, 20),
      ],
      expected: ['w-full', 'w-6/10', 'w-1/10', 'w-0', 'w-0', 'w-full'],
    });
  });
});
