import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { tiles } from './tiles';

setupRitewayBun();

const looksOf = (titles: readonly string[]) =>
  tiles.filter(({ title }) => titles.includes(title)).map(({ note }) => note);

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
      given: 'the Play and Seasons tiles',
      should: 'link them to the Lobby and the seasons page',
      actual: tiles
        .filter(({ title }) => title === 'Play' || title === 'Seasons')
        .map(({ href }) => href),
      expected: ['/lobby', '/leaderboard/seasons'],
    });
  });

  test('emphasises only Play', () => {
    assert({
      given: 'the tile colours',
      should: 'make Play the one action note, then yellow and sage as settled',
      actual: {
        action: tiles
          .filter(({ note }) => note === 'action')
          .map(({ title }) => title),
        yellow: looksOf(['Watch', 'Tournaments', 'Seasons', 'Train']),
        sage: looksOf(['Judge', 'Leaderboard', 'Prep']),
      },
      expected: {
        action: ['Play'],
        yellow: ['yellow', 'yellow', 'yellow', 'yellow'],
        sage: ['sage', 'sage', 'sage'],
      },
    });
  });

  test('gives Train the brain', () => {
    assert({
      given: 'the Train tile',
      should: 'wear the brain icon',
      actual: tiles.find(({ title }) => title === 'Train')?.glyph,
      expected: 'brain',
    });
  });

  test('says what Tournaments plans', () => {
    assert({
      given: 'the Tournaments tile',
      should: 'carry the settled tagline',
      actual: tiles.find(({ title }) => title === 'Tournaments')?.description,
      expected: 'Weekly round robins to season championships.',
    });
  });
});
