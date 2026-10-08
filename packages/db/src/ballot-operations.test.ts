import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const judgeSeat = 'j3s1e7a5t9i2d6c4b8k2q1w5e9r3t7y';
const actorId = 'k2v9x0f4m8q3w1z7c5n6b4d2';
describe('ballotOperations', () => {
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
