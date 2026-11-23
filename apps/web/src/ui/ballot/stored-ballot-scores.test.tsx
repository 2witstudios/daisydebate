import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotPlanFor } from '../../features/judge/ballot-plan';
import {
  sampleBallotRound,
  sampleJudgeBallot,
} from '../mock/judge.test-support';
import { renderAccessible } from '../../test-support/rendered/accessible';

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
  const view = renderAccessible(
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
      view.has('columnheader', 'a'.repeat(32)),
      view.has('columnheader', 'n'.repeat(32)),
      view.count('rowheader'),
      view.textContent().includes('AI judge'),
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
  const view = renderAccessible(
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
      view.has('rowheader', 'Framework'),
      view.has('rowheader', 'Analysis'),
      view.has('rowheader', 'Impact'),
      view.has('rowheader', 'Burdens'),
      view.within('row', /^Total/).names('cell'),
    ],
    expected: [true, true, true, false, ['30 / 50', '40 / 50']],
  });
});
