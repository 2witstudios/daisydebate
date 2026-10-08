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

const count = (pattern: RegExp) => (html.match(pattern) ?? []).length;

/** The text a screen reader hears for one side's number: the debater, then it. */
const said = (name: string, value: number) =>
  html.includes(`${name} </span>${value}</span>`);

describe('ScoreComparison', () => {
  test('the table', () => {
    assert({
      given: 'a judge’s ballot and the AI judge’s ballot',
      should:
        'head the category and both judges, give each of the ten categories and the total a row, group them, and name each number for a screen reader',
      actual: [
        count(/role="columnheader"/g),
        count(/role="rowheader"/g),
        count(/role="cell"/g),
        ['Construction', 'Clash', 'Cross-ex', 'Presentation'].every((group) =>
          html.includes(`aria-label="${group}"`),
        ),
        said('Maya Singh', 36) && said('Daniel Kim', 33),
        said('Maya Singh', 40) && said('Daniel Kim', 34),
      ],
      expected: [3, 11, 22, true, true, true],
    });
  });

  test('splits and citations', () => {
    assert({
      given:
        'scores two apart in one category and AI citations for three categories',
      should:
        'mark that category split once, and open citations only where the AI cited a turn',
      actual: [
        count(/>Split</g),
        count(/<details/g),
        html.includes('A fine against decades of excluded voters'),
      ],
      expected: [1, 3, true],
    });
  });
});
