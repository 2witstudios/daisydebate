import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleLibrary } from '../../../ui/mock/prep';
import { getCard } from './get-card';

setupRitewayBun();

describe('getCard', () => {
  test('known and unknown ids', () => {
    assert({
      given: 'a known and an unknown id',
      should: 'find the card, and nothing for the other',
      actual: [getCard('cost-estimates')?.tagLine, getCard('nope')],
      expected: ['Cost estimates depend on assumed take-up', undefined],
    });
  });

  test('every library card opens', () => {
    assert({
      given: 'the card items in the library',
      should: 'each resolve to a card with the same title and use count',
      actual: sampleLibrary('2026-09-30T12:00:00.000Z')
        .filter((item) => item.kind === 'card')
        .filter((item) => {
          const card = getCard(item.id);
          return (
            card === undefined ||
            card.tagLine !== item.title ||
            card.uses.length !== item.usedIn
          );
        })
        .map((item) => item.id),
      expected: [],
    });
  });
});
