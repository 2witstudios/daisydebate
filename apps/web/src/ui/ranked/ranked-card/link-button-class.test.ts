import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { linkButtonClass } from './link-button-class';

setupRitewayBun();

describe('linkButtonClass', () => {
  test('a button with no underline, plus extras', () => {
    const plain = linkButtonClass('secondary');
    assert({
      given: 'a secondary link button and one with an extra class',
      should: 'drop the underline and append the extra',
      actual: [
        plain.endsWith('no-underline hover:no-underline'),
        linkButtonClass('primary', 'w-full').endsWith(
          'hover:no-underline w-full',
        ),
      ],
      expected: [true, true],
    });
  });
});
