import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBallotDebaters, sampleJudgeBallot } from '../../mock/judge';
import { BallotSummary } from './ballot-summary';

setupRitewayBun();

const render = (feedback: typeof sampleJudgeBallot.feedback) =>
  renderToString(
    h(BallotSummary, {
      title: 'Judge',
      ballot: { ...sampleJudgeBallot, feedback },
      debaters: sampleBallotDebaters,
    }),
  );

describe('BallotSummary', () => {
  test('with feedback', () => {
    const html = render(sampleJudgeBallot.feedback);
    assert({
      given: 'a ballot with feedback for both debaters',
      should:
        'name who it voted for, give the reason and both pieces of feedback',
      actual: [
        html.includes('Voted Maya Singh'),
        html.includes(sampleJudgeBallot.reason),
        html.includes('>Feedback<'),
        html.includes('Answer every argument in your first rebuttal'),
        html.includes('Say why your impact outweighs theirs'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('without feedback', () => {
    assert({
      given: 'a ballot with no feedback',
      should: 'show no feedback heading',
      actual: render({}).includes('>Feedback<'),
      expected: false,
    });
  });
});
