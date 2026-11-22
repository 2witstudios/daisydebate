import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotPlanFor } from '../../features/judge/ballot-plan';
import {
  sampleBallotRound,
  sampleJudgeBallot,
} from '../mock/judge.test-support';

const named = (aff: string, neg: string) => {
  const [a, n] = sampleBallotRound.participants;
  return ballotPlanFor(
    {
      ...sampleBallotRound,
      participants: [
        { ...a!, label: aff },
        { ...n!, label: neg },
      ],
    },
    daisyWinnerBallot,
  );
};
import { StoredBallotScores } from './stored-ballot-scores';
import { daisyWinnerBallot } from '@daisy/protocol/ballot-definition';
setupRitewayBun();
test('recorded scores name both actual sides and every rubric category without a fabricated companion', () => {
  const html = renderToString(
    h(StoredBallotScores, {
      title: 'Recorded ballot scores',
      ballot: sampleJudgeBallot,
      plan: named('a'.repeat(32), 'n'.repeat(32)),
    }),
  );
  assert({
    given: 'one actual submitted ballot',
    should:
      'render both sides, all ten categories and totals with no invented AI vote',
    actual: [
      html.includes('a'.repeat(32)),
      html.includes('n'.repeat(32)),
      (html.match(/scope="row"/g) ?? []).length,
      html.includes('AI judge'),
    ],
    expected: [true, true, 11, false],
  });
});
test('a ballot written on the first rubric renders on its own categories', () => {
  const side = (score: number) => ({
    thesis: score,
    framework: score,
    analysis: score,
    refutation: score,
    impact: score,
    weighing: score,
    questioning: score,
    answering: score,
    organization: score,
    delivery: score,
  });
  const html = renderToString(
    h(StoredBallotScores, {
      title: 'Recorded ballot scores',
      ballot: {
        rubricVersion: 'speaker-10@1',
        winner: 'negative',
        scores: { affirmative: side(3), negative: side(4) },
        reason: 'The negative won the framework.',
        feedback: {},
      },
      plan: named('Aff', 'Neg'),
    }),
  );
  assert({
    given: 'a stored speaker-10@1 ballot',
    should:
      'show its Framework, Analysis and Impact rows, no Burdens row, and its own totals',
    actual: [
      html.includes('>Framework<'),
      html.includes('>Analysis<'),
      html.includes('>Impact<'),
      html.includes('>Burdens<'),
      html.includes('30<!-- --> / 50'),
      html.includes('40<!-- --> / 50'),
    ],
    expected: [true, true, true, false, true, true],
  });
});
