import type { RoundBallotRead } from '@daisy/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleJudgeBallot } from '../mock/judge';
import { completed } from './result.test-support';
import { RoundResult } from './round-result';

setupRitewayBun();

test('a debater reads the decision and the transcript, each labelled, with no round analysis', () => {
  const html = renderToStaticMarkup(<RoundResult view={completed} />);
  assert({
    given: 'a completed Round read by its affirmative debater',
    should:
      'label each ballot as the official decision by its kind of judge, show the debater’s own judge feedback and the transcript',
    actual: [
      'Official decision · Human judge',
      'Official decision · AI judge',
      'This ballot was voided and does not count.',
      'Feedback for you from the human judge',
      'Weigh earlier.',
      'Show the transcript',
      'Some speech was not captured',
      'Access improves.',
      '(cut off)',
    ].filter((text) => !html.includes(text)),
    expected: [],
  });
  assert({
    given: 'the result card',
    should: 'carry no round analysis: it has its own component and read',
    actual: /round analysis/i.test(html),
    expected: false,
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
    <RoundResult view={{ ...completed, transcript: null }} />,
  );
  assert({
    given: 'a completed Round read by a spectator',
    should: 'show the ballots but no transcript',
    actual: [html.includes('The decision'), html.includes('Transcript')],
    expected: [true, false],
  });
});

test('a debater without the round analysis entitlement keeps the whole official ballot', () => {
  // DEC-247: the official ballots, AI judge feedback included, are never
  // premium-gated; the ballot read is the same with or without premium.
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
  };
  const html = renderToStaticMarkup(<RoundResult view={view} />);
  assert({
    given:
      'a completed Round read by its affirmative debater with no round analysis entitlement',
    should:
      'show both official ballots with their feedback for the debater and the transcript',
    actual: [
      html.includes('Official decision · AI judge'),
      html.includes('Feedback for you from the AI judge'),
      html.includes(aiFeedback),
      html.includes('Weigh earlier.'),
      html.includes('Show the transcript'),
    ],
    expected: [true, true, true, true, true],
  });
});
