import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationSlugs } from './destinations';
import { destinationHref, explainerHref, launched, liveHref } from './launch';

setupRitewayBun();

const allSoon = Object.fromEntries(
  destinationSlugs.map((slug) => [slug, false]),
) as Record<(typeof destinationSlugs)[number], boolean>;

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
      given: 'the launch config for the unranked beta',
      should:
        'open the Lobby and the Judge hub and keep the rest behind explainers',
      actual: destinationSlugs.filter((slug) => launched[slug]),
      expected: ['lobby', 'judge'],
    });
  });
});

describe('destinationHref', () => {
  test('points an unlaunched destination at its explainer', () => {
    assert({
      given: 'a destination that is not launched',
      should: 'link to the explainer',
      actual: destinationHref('ranked', { config: allSoon }),
      expected: explainerHref('ranked'),
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
      given: 'a page inside ranked, launched and not',
      should: 'reach the page once launched and the explainer until then',
      actual: [
        destinationHref('ranked', { path: '/ranked/host', config: allSoon }),
        destinationHref('ranked', {
          path: '/ranked/host',
          config: { ...allSoon, ranked: true },
        }),
      ],
      expected: ['/coming-soon/ranked', '/ranked/host'],
    });
  });
});
