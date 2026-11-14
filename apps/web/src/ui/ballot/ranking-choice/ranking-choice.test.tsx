import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBallotPlan } from '../../mock/judge.test-support';
import { RankingChoice } from './ranking-choice';

setupRitewayBun();

describe('RankingChoice', () => {
  test('one choice per place, each offering every subject', () => {
    const html = renderToString(
      h(RankingChoice, {
        subjects: sampleBallotPlan.decided,
        values: { 'place-1': 'negative' },
      }),
    );
    assert({
      given: 'two sides to rank, the negative posted first',
      should: 'offer both in each of two places and keep the posted pick',
      actual: [
        (html.match(/<select/g) ?? []).length,
        (html.match(/value="affirmative"/g) ?? []).length,
        html.includes('Place 2'),
        html.includes('Maya Singh · Affirmative'),
      ],
      expected: [2, 2, true, true],
    });
  });
});
