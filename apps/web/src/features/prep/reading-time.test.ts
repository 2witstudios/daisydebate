import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  budget,
  formatClock,
  readSeconds,
  trimWords,
  wordCount,
} from './reading-time';

setupRitewayBun();

describe('reading time', () => {
  test('word count', () => {
    assert({
      given: 'empty, padded and multi-space text',
      should: 'count whitespace-separated words',
      actual: [wordCount(''), wordCount('  '), wordCount(' a  b\nc ')],
      expected: [0, 0, 3],
    });
  });

  test('seconds and clock', () => {
    assert({
      given: '440, 180 and 26 words at 160 a minute, and a zero pace',
      should: 'read 2:45, 1:08, 0:10 and 0:00',
      actual: [
        formatClock(readSeconds(440, 160)),
        formatClock(readSeconds(180, 160)),
        formatClock(readSeconds(26, 160)),
        formatClock(readSeconds(10, 0)),
      ],
      expected: ['2:45', '1:08', '0:10', '0:00'],
    });
  });

  test('budget against a limit', () => {
    assert({
      given: 'a read time over, under and far over a limit',
      should: 'flag over, give the gap and cap the bar at 100',
      actual: [budget(375, 360), budget(180, 360), budget(900, 360)],
      expected: [
        { over: true, deltaSeconds: 15, percent: 100 },
        { over: false, deltaSeconds: 180, percent: 50 },
        { over: true, deltaSeconds: 540, percent: 100 },
      ],
    });
  });

  test('trim words', () => {
    assert({
      given: '15 seconds over at 160 words a minute',
      should: 'suggest cutting 40 words',
      actual: trimWords(15, 160),
      expected: 40,
    });
  });
});
