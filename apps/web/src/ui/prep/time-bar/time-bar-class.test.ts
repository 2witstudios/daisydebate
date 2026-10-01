import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { timeBarClass } from './time-bar-class';

setupRitewayBun();

describe('timeBarClass', () => {
  test('over and within', () => {
    const base = 'h-2 w-full overflow-hidden rounded-round bg-surface-overlay';
    assert({
      given: 'a bar over the limit and one within it',
      should: 'colour them red and accent',
      actual: [timeBarClass(true), timeBarClass(false)],
      expected: [`${base} accent-live`, `${base} accent-accent`],
    });
  });
});
