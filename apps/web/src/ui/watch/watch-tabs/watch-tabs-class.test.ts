import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { watchTabClass } from './watch-tabs-class';

setupRitewayBun();

describe('watchTabClass', () => {
  test('selected and unselected', () => {
    assert({
      given: 'a selected and an unselected tab',
      should: 'accent the selected one only',
      actual: [
        watchTabClass(true).includes('border-accent text-accent'),
        watchTabClass(false).includes('border-transparent text-ink'),
      ],
      expected: [true, true],
    });
  });
});
