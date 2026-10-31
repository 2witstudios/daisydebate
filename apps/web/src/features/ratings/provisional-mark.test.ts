import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  markedRating,
  provisionalMark,
  provisionalMarkClass,
} from './provisional-mark';

setupRitewayBun();

describe('the compact provisional mark', () => {
  test('marks a provisional rating and leaves an established one bare', () => {
    assert({
      given: 'a rating on each side of the provisional line',
      should: 'end the provisional figure in a star and not touch the other',
      actual: [
        markedRating(1662.31, true),
        markedRating(1662, false),
        provisionalMark,
        provisionalMarkClass,
      ],
      expected: ['1662*', '1662', '*', 'italic'],
    });
  });
});
