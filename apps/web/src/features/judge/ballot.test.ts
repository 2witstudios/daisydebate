import { ballotCategories, type BallotCategory } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { postedForm } from '../../lib/testing/posted-form';
import {
  ballotDestination,
  ballotView,
  parseBallot,
  parseBallotState,
} from './ballot';

setupRitewayBun();

const scoresFor = (side: string, score: string) =>
  Object.fromEntries(ballotCategories.map((c) => [`${side}-${c}`, score]));

const valid = {
  winner: 'affirmative',
  ...scoresFor('affirmative', '4'),
  ...scoresFor('negative', '3'),
  reason: 'The affirmative answered the main objection.',
  'feedback-negative': 'Weigh your impacts against theirs.',
};

const debaters = {
  affirmative: { name: 'Maya Singh' },
  negative: { name: 'Daniel Kim' },
};

const allAt = (score: number) =>
  Object.fromEntries(ballotCategories.map((c) => [c, score])) as Record<
    BallotCategory,
    number
  >;

describe('parseBallot', () => {
  test('a valid ballot', () => {
    assert({
      given: 'a winner, twenty scores, a reason and feedback for one side',
      should: 'accept it on the current rubric with the scores read as numbers',
      actual: parseBallot(postedForm(valid), debaters),
      expected: {
        ok: true,
        value: {
          ballot: {
            rubricVersion: 'speaker-10@1',
            winner: 'affirmative',
            scores: { affirmative: allAt(4), negative: allAt(3) },
            reason: 'The affirmative answered the main objection.',
            feedback: { negative: 'Weigh your impacts against theirs.' },
          },
          reportConduct: false,
        },
      },
    });
  });

  test('a conduct report', () => {
    const result = parseBallot(
      postedForm({ ...valid, conduct: 'report' }),
      debaters,
    );
    assert({
      given: 'a ballot with the conduct box ticked',
      should: 'accept it and ask for a report',
      actual: result.ok && result.value.reportConduct,
      expected: true,
    });
  });

  test('each refusal', () => {
    const refusals = [
      { winner: 'draw' },
      { winner: '' },
      { 'negative-thesis': '6' },
      { 'affirmative-delivery': '' },
      { 'negative-impact': '4.0' },
      { 'negative-impact': '0x4' },
      { 'negative-impact': '4e0' },
      { reason: '   ' },
      { reason: 'x'.repeat(601) },
      { 'feedback-affirmative': 'x'.repeat(281) },
    ].map((change) => {
      const result = parseBallot(postedForm({ ...valid, ...change }), debaters);
      return result.ok ? null : result.error;
    });
    assert({
      given:
        'a draw, no winner, a bad, missing or non-digit score, a missing or long reason and long feedback',
      should: 'refuse each with its own message',
      actual: refusals,
      expected: [
        'Pick who won: Maya Singh or Daniel Kim.',
        'Pick who won: Maya Singh or Daniel Kim.',
        'Score every category from 1 to 5.',
        'Score every category from 1 to 5.',
        'Score every category from 1 to 5.',
        'Score every category from 1 to 5.',
        'Score every category from 1 to 5.',
        'Write the reason for your decision.',
        'A reason is up to 600 characters. Shorten it.',
        'Feedback is up to 280 characters. Shorten it.',
      ],
    });
  });

  test('line breaks', () => {
    // 540 letters and 59 line breaks: 599 as the textarea counts them.
    const lines = Array.from({ length: 60 }, () => 'x'.repeat(9)).join('\r\n');
    const result = parseBallot(
      postedForm({ ...valid, reason: lines, 'feedback-negative': 'a\r\nb' }),
      debaters,
    );
    assert({
      given:
        'a reason within the textarea’s limit whose line breaks the browser posts as two characters',
      should: 'accept it, counting and keeping each line break once',
      actual: result.ok && [
        result.value.ballot.reason.length,
        result.value.ballot.feedback.negative,
      ],
      expected: [599, 'a\nb'],
    });
  });

  test('a low-point win', () => {
    const lowPoint = { ...valid, winner: 'negative' };
    const refused = parseBallot(postedForm(lowPoint), debaters);
    const confirmed = parseBallot(
      postedForm({ ...lowPoint, 'low-point': 'confirmed' }),
      debaters,
    );
    assert({
      given: 'a winner on fewer points, unconfirmed and then confirmed',
      should: 'refuse it until the judge confirms, then accept it',
      actual: [refused.ok ? null : refused.error, confirmed.ok],
      expected: ['Confirm the low-point win, or change the scores.', true],
    });
  });
});

describe('ballot state and view', () => {
  test('the state from the address', () => {
    assert({
      given: 'no state, a known state and nonsense',
      should: 'default to open',
      actual: [
        parseBallotState({}),
        parseBallotState({ state: 'submitted' }),
        parseBallotState({ state: 'zzz' }),
      ],
      expected: ['open', 'submitted', 'open'],
    });
  });

  test('the three views', () => {
    const open = ballotView('d', 'Evening', 'open', debaters);
    assert({
      given: 'the three ballot states',
      should:
        'give a waiting, an open view naming the debaters, and a submitted view',
      actual: [
        ballotView('d', 'Evening', 'waiting', debaters).kind,
        open.kind === 'open' ? open.debaters.negative.name : null,
        ballotView('d', 'Evening', 'submitted', debaters).kind,
        ballotDestination('d'),
      ],
      expected: [
        'waiting',
        'Daniel Kim',
        'submitted',
        '/judge/ballot/d?state=submitted',
      ],
    });
  });
});
