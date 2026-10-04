import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { postedForm } from '../../lib/testing/posted-form';
import {
  ballotDestination,
  ballotView,
  parseBallot,
  parseBallotState,
} from './ballot';

setupRitewayBun();

const valid = {
  decision: 'affirmative',
  'affirmative-score': '4',
  'negative-score': '3',
  reason: 'The affirmative answered the main objection.',
};

describe('parseBallot', () => {
  test('a valid ballot', () => {
    assert({
      given: 'a decision, two scores and a reason',
      should: 'accept it with the scores read as numbers',
      actual: parseBallot(postedForm(valid)),
      expected: {
        ok: true,
        value: {
          decision: 'affirmative',
          affirmativeScore: 4,
          negativeScore: 3,
          reason: 'The affirmative answered the main objection.',
        },
      },
    });
  });

  test('each refusal', () => {
    const refusals = [
      { decision: 'tie' },
      { 'affirmative-score': '9' },
      { 'negative-score': '' },
      { reason: '   ' },
      { reason: 'x'.repeat(601) },
    ].map((change) => {
      const result = parseBallot(postedForm({ ...valid, ...change }));
      return result.ok ? null : result.error;
    });
    assert({
      given: 'an unknown decision, bad scores and a missing or long reason',
      should: 'refuse each with its own message',
      actual: refusals,
      expected: [
        'Choose who won: the affirmative, the negative or a draw.',
        'Give each side a score from 1 to 5.',
        'Give each side a score from 1 to 5.',
        'Write the reason for your decision.',
        'A reason is up to 600 characters. Shorten it.',
      ],
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
    assert({
      given: 'the three ballot states',
      should: 'give a waiting, an open and a submitted view',
      actual: [
        ballotView('d', 'Evening', 'waiting').kind,
        ballotView('d', 'Evening', 'open').kind,
        ballotView('d', 'Evening', 'submitted').kind,
        ballotDestination('d'),
      ],
      expected: [
        'waiting',
        'open',
        'submitted',
        '/judge/ballot/d?state=submitted',
      ],
    });
  });
});
