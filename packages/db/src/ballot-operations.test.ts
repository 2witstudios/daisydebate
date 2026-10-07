import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ballotCategories, type Ballot } from '@daisy/protocol';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const judgeSeat = 'j3s1e7a5t9i2d6c4b8k2q1w5e9r3t7y';
const actorId = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const ballotId = 'b1a2l3l4o5t6k7m8n9p1r3t5';

const scoresFor = (score: number) =>
  Object.fromEntries(ballotCategories.map((category) => [category, score]));

const ballot = (): Ballot => ({
  rubricVersion: 'speaker-10@1',
  winner: 'affirmative',
  scores: {
    affirmative: scoresFor(4),
    negative: scoresFor(3),
  } as Ballot['scores'],
  reason: 'The reasoning was clearer.',
  feedback: {},
});

describe('ballotOperations', () => {
  test('submits a ruling from a judge seat and reports it stored', async () => {
    const { database, queries } = createTestDatabase([[['judge']], [['b1']]]);
    const result = await database.submitBallot({
      ballotId,
      judgeParticipantId: judgeSeat,
      ballot: ballot(),
    });
    assert({
      given: 'a judge seat and a fresh ruling',
      should: 'store it and report stored',
      actual: result,
      expected: { stored: true },
    });
    assert({
      given: 'the insert',
      should: 'lock the seat row before writing',
      actual: queries[0]?.query.includes('for share'),
      expected: true,
    });
  });

  test('refuses a seat that does not exist and a seat that is no judge', async () => {
    const missing = createTestDatabase([[]]);
    await assertRejects({
      given: 'a judge participant id that names no seat',
      should: 'refuse with not-found',
      actual: () =>
        missing.database.submitBallot({
          ballotId,
          judgeParticipantId: judgeSeat,
          ballot: ballot(),
        }),
      code: 'NOT_FOUND',
    });
    const debater = createTestDatabase([[['negative']], []]);
    await assertRejects({
      given: 'a debater seat trying to hold a ballot',
      should: 'refuse with the judge-seat invariant',
      actual: () =>
        debater.database.submitBallot({
          ballotId,
          judgeParticipantId: judgeSeat,
          ballot: ballot(),
        }),
      code: 'INVARIANT',
    });
  });

  test('reports already-stored when the ruling lost the first-writer race', async () => {
    const { database } = createTestDatabase([[['judge']], []]);
    const result = await database.submitBallot({
      ballotId,
      judgeParticipantId: judgeSeat,
      ballot: ballot(),
    });
    assert({
      given: 'a seat whose ballot is already on file',
      should: 'report not stored and change nothing',
      actual: result,
      expected: { stored: false },
    });
  });

  test('voids a ruling after locking its round, and reports nothing to void', async () => {
    const { database, queries } = createTestDatabase([
      [['round-1']],
      [['round-1']],
      [['b1']],
    ]);
    const result = await database.voidBallot({
      judgeParticipantId: judgeSeat,
      voidedByActorId: actorId,
    });
    assert({
      given: 'a ruling on file',
      should: 'void it and report voided',
      actual: result,
      expected: { voided: true },
    });
    assert({
      given: 'the void transaction',
      should: 'lock the round row before updating',
      actual: queries[1]?.query.includes('for update'),
      expected: true,
    });
    const empty = createTestDatabase([[['round-1']], [['round-1']], []]);
    const nothing = await empty.database.voidBallot({
      judgeParticipantId: judgeSeat,
      voidedByActorId: actorId,
    });
    assert({
      given: 'a seat with no ruling on file',
      should: 'report not voided',
      actual: nothing,
      expected: { voided: false },
    });
    const missing = createTestDatabase([[]]);
    await assertRejects({
      given: 'a judge participant id that names no seat',
      should: 'refuse with not-found',
      actual: () =>
        missing.database.voidBallot({
          judgeParticipantId: judgeSeat,
          voidedByActorId: actorId,
        }),
      code: 'NOT_FOUND',
    });
  });

  test('reads a stored ruling back, or reports null', async () => {
    const { database } = createTestDatabase([[['ballot-row']]]);
    const stored = await database.getBallot(judgeSeat);
    assert({
      given: 'a ruling on file',
      should: 'read the row back rather than null',
      actual: stored !== null,
      expected: true,
    });
    const empty = createTestDatabase([[]]);
    const none = await empty.database.getBallot(judgeSeat);
    assert({
      given: 'no ruling on file',
      should: 'report null',
      actual: none,
      expected: null,
    });
  });
});
