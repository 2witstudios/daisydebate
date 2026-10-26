import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseBallot, parseCoaching } from './judge';
import {
  ballotCategories,
  type Ballot,
  type BallotCategory,
} from '@daisy/protocol';

setupRitewayBun();

const allAt = (score: number): Record<BallotCategory, number> =>
  Object.fromEntries(ballotCategories.map((c) => [c, score])) as Record<
    BallotCategory,
    number
  >;

const ballot: Ballot = {
  rubricVersion: 'speaker-10@1',
  winner: 'negative',
  scores: {
    affirmative: allAt(3),
    negative: { ...allAt(3), thesis: 4 },
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

describe('parseCoaching', () => {
  const coaching = {
    affirmative: 'Weigh your access impact against their cost argument.',
    negative: 'Answer the access turn before you extend.',
  };
  test('reads coaching for both sides, with or without a code fence', () => {
    assert({
      given: 'fenced JSON coaching for both sides',
      should: 'return each side’s coaching',
      actual: parseCoaching(`\`\`\`json\n${JSON.stringify(coaching)}\n\`\`\``),
      expected: coaching,
    });
  });
  test('refuses anything but coaching for both sides', async () => {
    await assertRejects({
      given: 'coaching for one side only',
      should: 'refuse with INFRASTRUCTURE',
      actual: async () =>
        parseCoaching(JSON.stringify({ affirmative: coaching.affirmative })),
      code: 'INFRASTRUCTURE',
    });
    await assertRejects({
      given: 'coaching longer than a ballot’s feedback limit',
      should: 'refuse with INFRASTRUCTURE',
      actual: async () =>
        parseCoaching(
          JSON.stringify({ ...coaching, negative: 'x'.repeat(281) }),
        ),
      code: 'INFRASTRUCTURE',
    });
    await assertRejects({
      given: 'text that is not JSON',
      should: 'refuse with INFRASTRUCTURE',
      actual: async () => parseCoaching('Great round!'),
      code: 'INFRASTRUCTURE',
    });
  });
});
