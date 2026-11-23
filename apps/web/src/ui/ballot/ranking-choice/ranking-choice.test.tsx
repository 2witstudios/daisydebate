import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBallotPlan } from '../../mock/judge.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { RankingChoice } from './ranking-choice';

setupRitewayBun();

describe('RankingChoice', () => {
  test('one choice per place, each offering every subject', () => {
    const view = renderAccessible(
      h(RankingChoice, {
        subjects: sampleBallotPlan.decided,
        values: { 'place-1': 'negative' },
      }),
    );
    assert({
      given: 'two sides to rank, the negative posted first',
      should: 'offer both in each of two places and keep the posted pick',
      actual: [
        view.count('combobox'),
        view
          .all('option', 'Maya Singh · Affirmative')
          .map((option) => option.getAttribute('value')),
        view.has('combobox', 'Place 2'),
        // The server marks the posted pick `selected`; happy-dom's parser
        // does not carry that into the option's selectedness, so read it.
        view
          .within('combobox', 'Place 1')
          .all('option')
          .filter((option) => option.hasAttribute('selected'))
          .map((option) => option.textContent),
      ],
      expected: [
        2,
        ['affirmative', 'affirmative'],
        true,
        ['Daniel Kim · Negative'],
      ],
    });
  });
});
