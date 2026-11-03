import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationSlugs } from './destinations';
import {
  closedDestinationOf,
  destinationHref,
  explainerHref,
  launched,
  liveHref,
} from './launch';

setupRitewayBun();

const allSoon = Object.fromEntries(
  destinationSlugs.map((slug) => [slug, false]),
) as Record<(typeof destinationSlugs)[number], boolean>;

describe('closedDestinationOf', () => {
  test('every route of a closed destination is closed', () => {
    assert({
      given: 'no destination launched',
      should: 'name the destination that owns each area, at any depth',
      actual: [
        '/lobby',
        '/watch/abc',
        '/recordings',
        '/judge/waiting',
        '/tournaments/organize/new',
        '/leaderboard/seasons',
        '/train',
        '//prep/cards/abc',
      ].map((path) => closedDestinationOf(path, allSoon)),
      expected: [
        'lobby',
        'watch',
        'watch',
        'judge',
        'tournaments',
        'leaderboard',
        'train',
        'prep',
      ],
    });
  });

  test('anything else stays open', () => {
    const allOpen = { ...allSoon, watch: true, prep: true };
    assert({
      given: 'paths no destination owns, lookalikes, and launched destinations',
      should: 'close none of them',
      actual: [
        closedDestinationOf('/', allSoon),
        closedDestinationOf('/settings', allSoon),
        closedDestinationOf('/coming-soon/prep', allSoon),
        closedDestinationOf('/prepare', allSoon),
        closedDestinationOf('/constructor', allSoon),
        closedDestinationOf('/recordings', allOpen),
        closedDestinationOf('/prep', allOpen),
      ],
      expected: [null, null, null, null, null, null, null],
    });
  });

  test('sample data is out of reach today', () => {
    assert({
      given: 'the launch config',
      should: 'close the areas that still read samples',
      actual: ['/tournaments', '/prep', '/watch', '/recordings'].map((path) =>
        closedDestinationOf(path),
      ),
      expected: ['tournaments', 'prep', 'watch', 'watch'],
    });
  });
});

describe('launch config', () => {
  test('names every destination', () => {
    assert({
      given: 'the launch config',
      should: 'have an entry per destination',
      actual: Object.keys(launched).sort(),
      expected: [...destinationSlugs].sort(),
    });
  });

  test('opens only the destinations with real screens', () => {
    assert({
      given: 'the launch config for the three-ladder beta',
      should: 'open Play, Judge, Seasons, the real leaderboard and Train',
      actual: destinationSlugs.filter((slug) => launched[slug]),
      expected: ['lobby', 'judge', 'seasons', 'leaderboard', 'train'],
    });
  });
});

describe('destinationHref', () => {
  test('points an unlaunched destination at its explainer', () => {
    assert({
      given: 'a destination that is not launched',
      should: 'link to the explainer',
      actual: destinationHref('watch', { config: allSoon }),
      expected: explainerHref('watch'),
    });
  });

  test('flipping one destination changes only that one', () => {
    assert({
      given: 'lobby flipped to launched',
      should: 'link lobby to its live route and leave the rest',
      actual: [
        destinationHref('lobby', { config: { ...allSoon, lobby: true } }),
        destinationHref('watch', { config: { ...allSoon, lobby: true } }),
      ],
      expected: [liveHref('lobby'), '/coming-soon/watch'],
    });
  });

  test('a deep link follows its destination', () => {
    assert({
      given: 'a page inside tournaments, launched and not',
      should: 'reach the page once launched and the explainer until then',
      actual: [
        destinationHref('tournaments', {
          path: '/tournaments/mine',
          config: allSoon,
        }),
        destinationHref('tournaments', {
          path: '/tournaments/mine',
          config: { ...allSoon, tournaments: true },
        }),
      ],
      expected: ['/coming-soon/tournaments', '/tournaments/mine'],
    });
  });

  test('Seasons lives under the leaderboard', () => {
    assert({
      given: 'the seasons destination, launched',
      should: 'link to the seasons page under the leaderboard',
      actual: destinationHref('seasons', {
        config: { ...allSoon, seasons: true },
      }),
      expected: '/leaderboard/seasons',
    });
  });
});
