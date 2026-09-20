import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { tiles } from './tiles';

setupRitewayBun();

describe('tiles config', () => {
  test('exposes the eight destinations exactly once', () => {
    const hrefs = tiles.map((tile) => tile.href);
    assert({
      given: 'the tile configuration',
      should: 'carry eight unique destination links',
      actual: [hrefs.length, new Set(hrefs).size],
      expected: [8, 8],
    });
  });

  test('orders the primary competitive modes first', () => {
    assert({
      given: 'the tile configuration',
      should: 'lead with ranked, lobby, and watch',
      actual: tiles.slice(0, 3).map((tile) => tile.title),
      expected: ['Ranked', 'Lobby', 'Watch'],
    });
  });

  test('gives every tile an icon, title, and description', () => {
    const complete = tiles.every(
      (tile) => tile.glyph && tile.title && tile.description,
    );
    assert({
      given: 'the tile configuration',
      should: 'keep every card renderable without optional data',
      actual: complete,
      expected: true,
    });
  });
});
