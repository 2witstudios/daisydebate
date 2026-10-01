import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationSlugs } from '../../features/coming-soon/destinations';
import { tileFor, tiles } from './tiles';

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

  test('tags every unlaunched destination and carries no fake counts', () => {
    assert({
      given: 'the tile configuration while nothing is launched',
      should:
        'link each tile to its explainer, tagged Coming soon, without a status',
      actual: tiles.map((tile) => [
        tile.href.startsWith('/coming-soon/'),
        tile.comingSoon,
        tile.status,
      ]),
      expected: tiles.map(() => [true, true, undefined]),
    });
  });

  test('flipping one destination to launched is one config change', () => {
    const config = Object.fromEntries(
      destinationSlugs.map((slug) => [slug, slug === 'lobby']),
    ) as Parameters<typeof tileFor>[1];
    assert({
      given: 'a config where only lobby is launched',
      should: 'link lobby to /lobby with a status line, untagged',
      actual: (({ href, comingSoon, status }) => ({
        href,
        comingSoon,
        status,
      }))(tileFor('lobby', config)),
      expected: {
        href: '/lobby',
        comingSoon: undefined,
        status: { tone: 'online', text: 'Open' },
      },
    });
  });
});
