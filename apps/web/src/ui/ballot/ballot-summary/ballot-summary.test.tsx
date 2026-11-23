import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  sampleBallotPlan,
  sampleJudgeBallot,
} from '../../mock/judge.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { BallotSummary } from './ballot-summary';

setupRitewayBun();

const render = (feedback: typeof sampleJudgeBallot.feedback) =>
  renderAccessible(
    h(BallotSummary, {
      title: 'Judge',
      ballot: { ...sampleJudgeBallot, feedback },
      plan: sampleBallotPlan,
    }),
  );

describe('BallotSummary', () => {
  test('with feedback', () => {
    const view = render(sampleJudgeBallot.feedback).within('region', 'Judge');
    const text = view.textContent();
    assert({
      given: 'a ballot with feedback for both debaters',
      should:
        'name who it voted for, give the reason and both pieces of feedback',
      actual: [
        text.includes('Voted Maya Singh'),
        text.includes(sampleJudgeBallot.reason!),
        view.has('heading', 'Feedback', { level: 4 }),
        text.includes('Answer every argument in your first rebuttal'),
        text.includes('Say why your impact outweighs theirs'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('without feedback', () => {
    assert({
      given: 'a ballot with no feedback',
      should: 'show no feedback heading',
      actual: render({}).has('heading', 'Feedback'),
      expected: false,
    });
  });
});
