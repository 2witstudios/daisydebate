import { ballotCategories } from '@daisy/protocol/ballot';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBallotPlan } from '../../mock/judge.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { ScoreSheet } from './score-sheet';

setupRitewayBun();

const at = (score: number) =>
  Object.fromEntries(ballotCategories.map((c) => [c, score])) as Record<
    (typeof ballotCategories)[number],
    number
  >;

const scores = { affirmative: at(4), negative: { ...at(3), delivery: 5 } };
const render = (live: boolean) =>
  renderAccessible(
    h(ScoreSheet, {
      points: sampleBallotPlan.definition.points!,
      subjects: sampleBallotPlan.scored,
      initial: scores,
      scores,
      live,
      onScore: () => undefined,
    }),
  );
const range = (slider: Element) =>
  `${slider.getAttribute('min')}–${slider.getAttribute('max')}`;
/** The anchors disclosures: the only unnamed groups on the sheet. */
const disclosures = (sheet: ReturnType<typeof render>) =>
  sheet.names('group').filter((name) => name === '').length;

describe('ScoreSheet', () => {
  test('sliders', () => {
    const view = render(true);
    assert({
      given: 'scores for both debaters',
      should:
        'post one 1–5 slider per side and category, named for both, holding each score',
      actual: [
        view.count('slider'),
        view.all('slider').filter((slider) => range(slider) === '1–5').length,
        view.attribute('slider', 'Thesis, Maya Singh', 'name'),
        view.attribute('slider', 'Delivery, Daniel Kim', 'name'),
      ],
      expected: [20, 20, 'affirmative-thesis', 'negative-delivery'],
    });
  });

  test('totals and anchors', () => {
    const view = render(true);
    assert({
      given: 'ten 4s for one side and nine 3s and a 5 for the other',
      should: 'total 40 and 32 out of 50, and carry each category’s anchors',
      actual: [
        view.textContent().includes('Maya Singh: 40/ 50'),
        view.textContent().includes('Daniel Kim: 32/ 50'),
        disclosures(view),
        view
          .textContent()
          .includes(
            'Set the burdens the round was decided on, and won the dispute over them',
          ),
      ],
      expected: [true, true, 10, true],
    });
  });

  test('before hydration', () => {
    const still = render(false);
    assert({
      given: 'a sheet rendered before script runs',
      should:
        'post the same sliders seeded with the scores, and show no totals or numbers that would go stale',
      actual: [
        still.count('slider'),
        still.attribute('slider', 'Delivery, Daniel Kim', 'value'),
        still.textContent().includes('Speaker score'),
      ],
      expected: [20, '5', false],
    });
  });
});
