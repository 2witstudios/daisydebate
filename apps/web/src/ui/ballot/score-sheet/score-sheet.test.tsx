import { ballotCategories } from '@daisy/protocol';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBallotDebaters } from '../../mock/judge';
import { ScoreSheet } from './score-sheet';

setupRitewayBun();

const at = (score: number) =>
  Object.fromEntries(ballotCategories.map((c) => [c, score])) as Record<
    (typeof ballotCategories)[number],
    number
  >;

const html = renderToString(
  h(ScoreSheet, {
    debaters: sampleBallotDebaters,
    scores: { affirmative: at(4), negative: { ...at(3), delivery: 5 } },
    onScore: () => undefined,
  }),
);

describe('ScoreSheet', () => {
  test('sliders', () => {
    assert({
      given: 'scores for both debaters',
      should:
        'post one 1–5 slider per side and category, named for both, holding each score',
      actual: [
        (html.match(/type="range"/g) ?? []).length,
        (html.match(/min="1" max="5"/g) ?? []).length,
        html.includes('name="affirmative-thesis"'),
        html.includes('name="negative-delivery"'),
        html.includes('Delivery, Daniel Kim'),
      ],
      expected: [20, 20, true, true, true],
    });
  });

  test('totals and anchors', () => {
    assert({
      given: 'ten 4s for one side and nine 3s and a 5 for the other',
      should: 'total 40 and 32 out of 50, and carry each category’s anchors',
      actual: [
        html.includes('Maya Singh, 40 of 50'),
        html.includes('Daniel Kim, 32 of 50'),
        (html.match(/<details/g) ?? []).length,
        html.includes('Set the terms the round was judged on'),
      ],
      expected: [true, true, 10, true],
    });
  });
});
