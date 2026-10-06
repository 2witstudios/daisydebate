import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  sampleAiBallot,
  sampleBallotDebaters,
  sampleJudgeBallot,
} from '../../mock/judge';
import { ScoreComparison } from './score-comparison';

setupRitewayBun();

const html = renderToString(
  h(ScoreComparison, {
    debaters: sampleBallotDebaters,
    judge: sampleJudgeBallot,
    ai: sampleAiBallot,
  }),
);

describe('ScoreComparison', () => {
  test('the table', () => {
    assert({
      given: 'a judge’s ballot and the AI judge’s ballot',
      should:
        'head both ballots, list the ten categories in four groups and total each side for each judge',
      actual: [
        html.includes('>Judge<') && html.includes('>AI judge<'),
        (html.match(/scope="row"/g) ?? []).length,
        ['Construction', 'Clash', 'Cross-ex', 'Presentation'].every((group) =>
          html.includes(`>${group}<`),
        ),
        ['>36<', '>33<', '>40<', '>34<'].every((total) => html.includes(total)),
      ],
      expected: [true, 11, true, true],
    });
  });

  test('splits and citations', () => {
    assert({
      given: 'scores two apart in one category and AI citations',
      should: 'mark that category split once and show the cited turns',
      actual: [
        (html.match(/>Split</g) ?? []).length,
        html.includes('A fine against decades of excluded voters'),
      ],
      expected: [1, true],
    });
  });
});
