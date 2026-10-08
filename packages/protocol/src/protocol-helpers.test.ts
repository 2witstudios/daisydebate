import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ballotCategories, seatSlotsComplete, speakerTotal } from './index';

setupRitewayBun();

describe('speaker total', () => {
  test('sums one side’s ten category scores', () => {
    const scores = Object.fromEntries(
      ballotCategories.map((category, index) => [category, index + 1]),
    ) as Record<(typeof ballotCategories)[number], number>;
    assert({
      given: 'the ten category scores 1 through 10',
      should: 'sum them',
      actual: speakerTotal(scores),
      expected: 55,
    });
  });
});

describe('seat completeness', () => {
  test('accepts exactly the slots 0..wanted-1 and refuses anything else', () => {
    assert({
      given: 'two held slots for a two-seat role',
      should: 'accept them in order',
      actual: seatSlotsComplete(2, [0, 1]),
      expected: true,
    });
    assert({
      given: 'a missing slot',
      should: 'refuse an incomplete role',
      actual: seatSlotsComplete(2, [0]),
      expected: false,
    });
    assert({
      given: 'an out-of-range slot',
      should: 'refuse slots that skip a number',
      actual: seatSlotsComplete(2, [0, 2]),
      expected: false,
    });
    assert({
      given: 'an extra seat',
      should: 'refuse more seats than the role declares',
      actual: seatSlotsComplete(1, [0, 1]),
      expected: false,
    });
  });
});
