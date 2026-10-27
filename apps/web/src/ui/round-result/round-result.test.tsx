import type { RoundBallotRead } from '@daisy/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleJudgeBallot } from '../mock/judge';
import { completed } from './result.test-support';
import { RoundResult } from './round-result';

setupRitewayBun();

test('a debater reads the decision, their coaching and the transcript, each labelled', () => {
  const html = renderToStaticMarkup(<RoundResult view={completed} />);
  assert({
    given: 'a completed Round read by its affirmative debater',
    should:
      'label each ballot as the official decision by its kind of judge, show the debater’s own feedback and private coaching apart from it, and the transcript',
    actual: [
      'Official decision · Human judge',
      'Official decision · AI judge',
      'This ballot was voided and does not count.',
      'Feedback for you from the human judge',
      'Weigh earlier.',
      'AI coaching for you',
      'Answer the cost turn first.',
      'does not change the decision',
      'Show the transcript',
      'Some speech was not captured',
      'Access improves.',
      '(cut off)',
    ].filter((text) => !html.includes(text)),
    expected: [],
  });
  assert({
    given: 'the result inside the receipt’s main landmark',
    should: 'add no header, so the receipt’s header stays the page’s only one',
    actual: html.includes('<header'),
    expected: false,
  });
});

test('a reader who did not debate sees only the decision', () => {
  const html = renderToStaticMarkup(
    <RoundResult view={{ ...completed, coaching: null, transcript: null }} />,
  );
  assert({
    given: 'a completed Round read by a spectator',
    should: 'show the ballots but no coaching or transcript',
    actual: [
      html.includes('The decision'),
      html.includes('AI coaching for you'),
      html.includes('Transcript'),
    ],
    expected: [true, false, false],
  });
});

test('a debater without the coaching entitlement keeps the whole official ballot', () => {
  // ISSUE-664: the ballot read leaves coaching out when the reader lacks the
  // premium entitlement; the official ballots, AI feedback included, are never gated.
  const aiFeedback = 'Signpost the cost turn.';
  const view: RoundBallotRead = {
    ...completed,
    ballots: [
      completed.ballots[0]!,
      {
        status: 'submitted',
        judge: 'ai',
        ballot: { ...sampleJudgeBallot, feedback: { affirmative: aiFeedback } },
      },
    ],
    coaching: null,
  };
  const html = renderToStaticMarkup(<RoundResult view={view} />);
  assert({
    given:
      'a completed Round read by its affirmative debater with no coaching entitlement',
    should:
      'show both official ballots with their feedback for the debater and the transcript, and no coaching section',
    actual: [
      html.includes('Official decision · AI judge'),
      html.includes('Feedback for you from the AI judge'),
      html.includes(aiFeedback),
      html.includes('Weigh earlier.'),
      html.includes('Show the transcript'),
      html.includes('AI coaching for you'),
      html.includes('Your coaching'),
    ],
    expected: [true, true, true, true, true, false, false],
  });
});
