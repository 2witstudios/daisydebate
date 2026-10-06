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

const scores = { affirmative: at(4), negative: { ...at(3), delivery: 5 } };
const render = (live: boolean) =>
  renderToString(
    h(ScoreSheet, {
      debaters: sampleBallotDebaters,
      initial: scores,
      scores,
      live,
      onScore: () => undefined,
    }),
  );
const html = render(true);

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
        /Maya Singh: <\/span><span[^>]*>40<\/span><span[^>]*>\/ 50/.test(html),
        /Daniel Kim: <\/span><span[^>]*>32<\/span><span[^>]*>\/ 50/.test(html),
        (html.match(/<details/g) ?? []).length,
        html.includes('Set the terms the round was judged on'),
      ],
      expected: [true, true, 10, true],
    });
  });

  test('without script', () => {
    const still = render(false);
    assert({
      given: 'a sheet rendered before script runs',
      should:
        'post the same sliders seeded with the scores, and show no totals or numbers that would go stale',
      actual: [
        (still.match(/type="range"/g) ?? []).length,
        still.includes('name="negative-delivery"') && /value="5"/.test(still),
        still.includes('Speaker score'),
      ],
      expected: [20, true, false],
    });
  });
});
