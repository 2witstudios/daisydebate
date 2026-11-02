import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationSlugs } from '../../features/coming-soon/destinations';
import { launched } from '../../features/coming-soon/launch';
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

  test('orders the destinations for the landing', () => {
    assert({
      given: 'the tile configuration',
      should: 'lead with Play and carry no Ranked or Lobby tile',
      actual: tiles.map((tile) => tile.title),
      expected: [
        'Play',
        'Watch',
        'Judge',
        'Tournaments',
        'Seasons',
        'Leaderboard',
        'Train',
        'Prep',
      ],
    });
  });

  test('sends Play to the Lobby and Seasons to its page', () => {
    assert({
      given: 'the launched Play and Seasons tiles',
      should: 'link them to the Lobby and the seasons page',
      actual: tiles
        .filter(({ title }) => title === 'Play' || title === 'Seasons')
        .map(({ href }) => href),
      expected: ['/lobby', '/leaderboard/seasons'],
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
      given: 'the tile configuration',
      should:
        'link each unlaunched tile to its explainer, tagged Coming soon, without a status',
      actual: tiles
        .filter((_, index) => !launched[destinationSlugs[index]!])
        .map((tile) => [
          tile.href.startsWith('/coming-soon/'),
          tile.comingSoon,
          tile.status,
        ]),
      expected: destinationSlugs
        .filter((slug) => !launched[slug])
        .map(() => [true, true, undefined]),
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
