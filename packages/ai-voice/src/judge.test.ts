import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseBallot } from './judge';

setupRitewayBun();

const ballot = {
  winner: 'negative',
  reason:
    'The negative extended its safety contention, which the affirmative dropped.',
  speeches: [
    {
      turn: 'AC',
      side: 'affirmative',
      strengths: 'Clear.',
      improvements: 'Weigh impacts.',
    },
  ],
  tips: ['Answer every contention.', 'Signpost.', 'Weigh.'],
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
  });
});
