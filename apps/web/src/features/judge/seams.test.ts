import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getJudgeRating } from './get-judge-rating';
import { listJudgeResources } from './list-judge-resources';
import { hubResources } from './resources';

setupRitewayBun();

describe('the judge seams', () => {
  test('the rating', () => {
    const rating = getJudgeRating();
    assert({
      given: 'the sample judge',
      should: 'be provisional with recent ballots',
      actual: [rating.status, rating.recent.length > 0],
      expected: ['provisional', true],
    });
  });

  test('the resources', () => {
    const resources = listJudgeResources();
    assert({
      given: 'the sample resources',
      should:
        'list six cards, four on the hub, and one needed to qualify (practice)',
      actual: [
        resources.length,
        hubResources(resources).length,
        resources
          .filter(({ neededToQualify }) => neededToQualify)
          .map(({ kind }) => kind),
      ],
      expected: [6, 4, ['practice']],
    });
  });
});
