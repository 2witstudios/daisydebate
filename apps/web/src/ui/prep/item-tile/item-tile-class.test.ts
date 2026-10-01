import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { itemTileClass } from './item-tile-class';

setupRitewayBun();

describe('itemTileClass', () => {
  test('one tone per kind', () => {
    const base =
      'inline-flex size-avatar-md shrink-0 items-center justify-center rounded-md';
    assert({
      given: 'a brief, a card and a case',
      should: 'tint them accent, gold and neutral',
      actual: [
        itemTileClass('brief'),
        itemTileClass('card'),
        itemTileClass('case'),
      ],
      expected: [
        `${base} bg-accent-soft text-accent`,
        `${base} bg-gold-soft text-gold`,
        `${base} bg-surface-overlay text-ink-muted`,
      ],
    });
  });
});
