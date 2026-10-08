import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseBallot } from './judge';
import type { Ballot } from '@daisy/protocol';

setupRitewayBun();

const ballot: Ballot = {
  rubricVersion: 'speaker-10@1',
  winner: 'negative',
  scores: {
    affirmative: {
      thesis: 3,
      framework: 3,
      analysis: 3,
      refutation: 3,
      impact: 3,
      weighing: 3,
      questioning: 3,
      answering: 3,
      organization: 3,
      delivery: 3,
    },
    negative: {
      thesis: 4,
      framework: 3,
      analysis: 3,
      refutation: 3,
      impact: 3,
      weighing: 3,
      questioning: 3,
      answering: 3,
      organization: 3,
      delivery: 3,
    },
  },
  reason:
    'The negative extended its safety contention, which the affirmative dropped.',
  feedback: {
    affirmative: 'Answer every contention and weigh the impacts.',
    negative: 'Signpost the extension clearly so the judge can follow it.',
  },
};

describe('parseBallot', () => {
  test('reads a JSON ballot, with or without a code fence', () => {
    assert({
      given: 'a plain JSON ballot',
      should: 'return it',
      actual: parseBallot(JSON.stringify(ballot)),
      expected: ballot,
    });
    assert({
      given: 'a ballot wrapped in a markdown code fence',
      should: 'return the same ballot',
      actual: parseBallot('```json\n' + JSON.stringify(ballot) + '\n```'),
      expected: ballot,
    });
  });

  test('refuses a malformed ballot as an infrastructure failure', async () => {
    await assertRejects({
      given: 'a ballot naming no valid winner',
      should: 'refuse with INFRASTRUCTURE',
      actual: async () =>
        parseBallot(JSON.stringify({ ...ballot, winner: 'draw' })),
      code: 'INFRASTRUCTURE',
    });
    await assertRejects({
      given: 'a ballot missing a category score',
      should: 'refuse with INFRASTRUCTURE',
      actual: async () =>
        parseBallot(
          JSON.stringify({
            ...ballot,
            scores: {
              ...ballot.scores,
              affirmative: Object.fromEntries(
                Object.entries(ballot.scores.affirmative).filter(
                  ([category]) => category !== 'thesis',
                ),
              ),
            },
          }),
        ),
      code: 'INFRASTRUCTURE',
    });
  });
});
