import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleJudgeBallot } from '../mock/judge';
import { StoredBallotScores } from './stored-ballot-scores';
setupRitewayBun();
test('recorded scores name both actual sides and every rubric category without a fabricated companion', () => {
  const html = renderToString(
    h(StoredBallotScores, {
      title: 'Recorded ballot scores',
      ballot: sampleJudgeBallot,
      debaters: {
        affirmative: { name: 'a'.repeat(32) },
        negative: { name: 'n'.repeat(32) },
      },
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
