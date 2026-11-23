import type { RoundBallotRead } from '@daisy/protocol/round-ballot-read';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleJudgeBallot } from '../mock/judge.test-support';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { postedBy } from '../debate-room/posted-fields.test-support';
import { completed } from './result.test-support';
import { RoundResult } from './round-result';

setupRitewayBun();

test('a debater reads the decision and the transcript, each labelled, with no round analysis', () => {
  const text = renderAccessible(
    <RoundResult reportAction={() => {}} view={completed} />,
  ).textContent();
  assert({
    given: 'a completed Round read by its affirmative debater',
    should:
      'label each ballot as the official decision by its kind of judge, show the debater’s own judge feedback and the transcript',
    actual: [
      'Official decision · Human judge',
      'Official decision · AI judge',
      'Feedback for you from the human judge',
      'Weigh earlier.',
      'Show the transcript',
      'Some speech was not captured',
      'Access improves.',
      '(cut off)',
    ].filter((part) => !text.includes(part)),
    expected: [],
  });
  assert({
    given: 'the result card',
    should: 'carry no round analysis: it has its own component and read',
    actual: /round analysis/i.test(text),
    expected: false,
  });
  // That the result adds no <header> element: markup-contracts/round-result.
});

test('a reader who did not debate sees only the decision', () => {
  const view = renderAccessible(
    <RoundResult
      reportAction={() => {}}
      view={{ ...completed, transcript: null }}
    />,
  );
  assert({
    given: 'a completed Round read by a spectator',
    should: 'show the ballots but no transcript',
    actual: [
      view.has('region', 'The decision'),
      view.textContent().includes('Transcript'),
    ],
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
        judge: 'ai',
        reportableFeedbackId: null,
        ballot: { ...sampleJudgeBallot, feedback: { affirmative: aiFeedback } },
      },
    ],
  };
  const text = renderAccessible(
    <RoundResult reportAction={() => {}} view={view} />,
  ).textContent();
  assert({
    given:
      'a completed Round read by its affirmative debater with no round analysis entitlement',
    should:
      'show both official ballots with their feedback for the debater and the transcript',
    actual: [
      text.includes('Official decision · AI judge'),
      text.includes('Feedback for you from the AI judge'),
      text.includes(aiFeedback),
      text.includes('Weigh earlier.'),
      text.includes('Show the transcript'),
    ],
    expected: [true, true, true, true, true],
  });
});

test('only feedback the reader may report offers a report', () => {
  const view = renderAccessible(
    <RoundResult reportAction={() => {}} view={completed} />,
  );
  assert({
    given: 'one ballot with feedback for the reader and one voided without any',
    should: 'offer exactly one report, naming that ballot and no judge',
    actual: [
      view.textContent().split('Report this feedback').length - 1,
      postedBy(view, 'Send report').targetId,
    ],
    expected: [1, 'f'.repeat(24)],
  });
});
