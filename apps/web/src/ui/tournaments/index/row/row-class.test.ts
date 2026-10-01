import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rowColumnClass, rowGridClass } from './row-class';

setupRitewayBun();

describe('row classes', () => {
  test('twelve desktop columns that stack on the phone', () => {
    assert({
      given: 'each column',
      should:
        'span 4, 3, 3 and 2 of twelve, all full-width or halves on the phone',
      actual: [
        rowColumnClass('name'),
        rowColumnClass('when'),
        rowColumnClass('slots'),
        rowColumnClass('action'),
        rowGridClass.includes('grid-cols-12'),
      ],
      expected: [
        'col-span-4 min-w-0 max-compact:col-span-2',
        'col-span-3 max-compact:col-span-2',
        'col-span-3 max-compact:col-span-1',
        'col-span-2 max-compact:col-span-1',
        true,
      ],
    });
  });
});
