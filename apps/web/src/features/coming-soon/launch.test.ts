import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationSlugs } from './destinations';
import { explainerHref, launched, liveHref, tileHref } from './launch';

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

  test('has nothing launched yet', () => {
    assert({
      given: 'the launch config',
      should: 'keep every destination behind its explainer',
      actual: destinationSlugs.filter((slug) => launched[slug]),
      expected: [],
    });
  });
});

describe('tileHref', () => {
  test('points an unlaunched destination at its explainer', () => {
    assert({
      given: 'a destination that is not launched',
      should: 'link to the explainer',
      actual: tileHref('ranked', allSoon),
      expected: explainerHref('ranked'),
    });
  });

  test('flipping one destination changes only that one', () => {
    assert({
      given: 'lobby flipped to launched',
      should: 'link lobby to its live route and leave the rest',
      actual: [
        tileHref('lobby', { ...allSoon, lobby: true }),
        tileHref('watch', { ...allSoon, lobby: true }),
      ],
      expected: [liveHref('lobby'), '/coming-soon/watch'],
    });
  });
});
