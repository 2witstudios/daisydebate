import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  itemBadgeClass,
  itemKindClass,
  itemTileClass,
} from './item-tile-class';

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

describe('itemKindClass and itemBadgeClass', () => {
  test('one hue per kind', () => {
    assert({
      given: 'a brief, a card and a case',
      should: 'colour the kind word and badge sky, clay and plum',
      actual: [
        itemKindClass('brief').endsWith('text-hue-sky'),
        itemKindClass('card').endsWith('text-hue-clay'),
        itemBadgeClass('case').endsWith('bg-hue-plum-soft text-hue-plum'),
      ],
      expected: [true, true, true],
    });
  });
});
