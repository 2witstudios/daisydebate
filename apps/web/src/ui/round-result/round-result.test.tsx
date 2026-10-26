import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
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
