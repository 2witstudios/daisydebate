import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { bloomBand, bloomLabel, bloomPetals } from './bloom';

setupRitewayBun();

describe('bloomBand', () => {
  test('band floors', () => {
    assert({
      given: 'ratings on and either side of each floor',
      should: 'derive the band from the rating alone',
      actual: [1299, 1300, 1499, 1500, 1699, 1700].map(bloomBand),
      expected: ['sprout', 'bud', 'bud', 'bloom', 'bloom', 'full-bloom'],
    });
  });
});

describe('bloomLabel and bloomPetals', () => {
  test('labels and petal counts', () => {
    assert({
      given: 'every band and the provisional marker',
      should: 'name them and count filled petals 2, 4, 6, 8 (none provisional)',
      actual: (
        ['sprout', 'bud', 'bloom', 'full-bloom', 'provisional'] as const
      ).map((band) => [bloomLabel(band), bloomPetals(band)]),
      expected: [
        ['Sprout', 2],
        ['Bud', 4],
        ['Bloom', 6],
        ['Full bloom', 8],
        ['Provisional', 0],
      ],
    });
  });
});
