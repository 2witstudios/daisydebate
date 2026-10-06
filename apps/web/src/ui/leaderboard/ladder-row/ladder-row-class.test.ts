import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ladderColumnClass,
  moveClass,
  rankClass,
  rowClass,
} from './ladder-row-class';

setupRitewayBun();

describe('ladder row classes', () => {
  test('columns', () => {
    assert({
      given: 'each column',
      should:
        'place it on the twelve-column grid, with no band column, and hide record on the phone',
      actual: (['rank', 'name', 'rating', 'record', 'move'] as const).map(
        ladderColumnClass,
      ),
      expected: [
        'col-span-1',
        'col-span-6 min-w-0 max-compact:col-span-6',
        'col-span-2 max-compact:col-span-2',
        'col-span-2 max-compact:hidden',
        'col-span-1 max-compact:col-span-3',
      ],
    });
  });

  test('tones', () => {
    assert({
      given: 'each move kind and a top, lower and missing rank',
      should: 'colour ups green and only the top three gold',
      actual: [
        (['up', 'down', 'flat', 'none'] as const).map(moveClass),
        [1, 3, 4, null].map(rankClass),
      ],
      expected: [
        ['text-online', 'text-ink-muted', 'text-ink-faint', 'text-ink-faint'],
        ['text-gold', 'text-gold', 'text-ink-muted', 'text-ink-muted'],
      ],
    });
  });

  test('row surface', () => {
    const base =
      'px-5 py-3 min-h-12 text-base text-ink no-underline hover:no-underline max-compact:px-4';
    assert({
      given: 'selected, own and plain rows',
      should: 'pick one surface each, selected before own',
      actual: [
        rowClass({ selected: true, me: true }),
        rowClass({ selected: false, me: true }),
        rowClass({ selected: false, me: false }),
      ],
      expected: [
        `${base} bg-surface-overlay`,
        `${base} bg-accent-soft`,
        `${base} hover:bg-surface-raised`,
      ],
    });
  });
});
