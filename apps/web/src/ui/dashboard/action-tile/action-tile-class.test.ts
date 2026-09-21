import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { actionTileTintClass } from './action-tile-class';

setupRitewayBun();

describe('actionTileTintClass', () => {
  test('accent tints the glyph with the accent', () => {
    assert({
      given: 'the accent tint',
      should: 'color the glyph with the accent',
      actual: actionTileTintClass('accent'),
      expected: 'text-accent',
    });
  });

  test('gold tints the glyph with gold', () => {
    assert({
      given: 'the gold tint',
      should: 'color the glyph with gold',
      actual: actionTileTintClass('gold'),
      expected: 'text-gold',
    });
  });

  test('neutral uses the glyph ink', () => {
    assert({
      given: 'the neutral tint',
      should: 'color the glyph with the neutral glyph ink',
      actual: actionTileTintClass('neutral'),
      expected: 'text-glyph',
    });
  });
});
