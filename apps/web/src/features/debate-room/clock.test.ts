import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  cancelEndSpeech,
  clockUrgency,
  formatClock,
  pressEndSpeech,
} from './clock';

setupRitewayBun();

describe('formatClock', () => {
  test('rounding up partial seconds', () => {
    assert({
      given: 'a running clock with 1ms left',
      should: 'still show 0:01',
      actual: formatClock(1),
      expected: '0:01',
    });
    assert({
      given: 'exactly zero',
      should: 'show 0:00',
      actual: formatClock(0),
      expected: '0:00',
    });
    assert({
      given: 'four minutes and a fraction',
      should: 'round the fraction up',
      actual: formatClock(240_001),
      expected: '4:01',
    });
    assert({
      given: 'an overrun clock',
      should: 'clamp to 0:00',
      actual: formatClock(-5_000),
      expected: '0:00',
    });
  });
});

describe('clockUrgency', () => {
  test('thresholds', () => {
    assert({
      given: 'more than a minute left',
      should: 'be normal',
      actual: clockUrgency(60_001),
      expected: 'normal',
    });
    assert({
      given: 'exactly a minute left',
      should: 'be low',
      actual: clockUrgency(60_000),
      expected: 'low',
    });
    assert({
      given: 'fifteen seconds left',
      should: 'be critical',
      actual: clockUrgency(15_000),
      expected: 'critical',
    });
    assert({
      given: 'no time left',
      should: 'be over',
      actual: clockUrgency(0),
      expected: 'over',
    });
  });
});

describe('end speech confirmation', () => {
  test('press and cancel', () => {
    assert({
      given: 'an idle button pressed',
      should: 'arm it',
      actual: pressEndSpeech('idle'),
      expected: 'armed',
    });
    assert({
      given: 'an armed button pressed',
      should: 'end the speech',
      actual: pressEndSpeech('armed'),
      expected: 'ended',
    });
    assert({
      given: 'an ended speech pressed again',
      should: 'stay ended',
      actual: pressEndSpeech('ended'),
      expected: 'ended',
    });
    assert({
      given: 'an armed button cancelled',
      should: 'return to idle',
      actual: cancelEndSpeech('armed'),
      expected: 'idle',
    });
    assert({
      given: 'an ended speech cancelled',
      should: 'stay ended',
      actual: cancelEndSpeech('ended'),
      expected: 'ended',
    });
  });
});
