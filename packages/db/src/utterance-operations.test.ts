import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const roundId = 'r2o8u4n6d8i1d3a5c7t9e2v4';
const segmentId = 's3e8g2m6e1n4t9i2d6c4b8k2';
const speakerId = 'p4a7r1t9i3c6i2p8a5n7t1d4';

describe('utteranceOperations', () => {
  test('refuses unscoped transcript writes before issuing SQL', async () => {
    const { database, queries } = createTestDatabase([]);
    const common = {
      id: 'u1',
      roundId,
      text: 'Untrusted words.',
      requireOpen: true,
    };
    const mutations = [
      () =>
        database.appendUtterance({
          ...common,
          segmentId,
          roundParticipantId: speakerId,
        }),
      () => database.replaceUtterance({ ...common, requireOpen: false }),
      () => database.replaceUtterance({ ...common, complete: true }),
      () =>
        database.replaceUtterance({
          ...common,
          requireOpen: true,
          speechToken: 'untrusted-claim',
        }),
    ];
    for (const mutation of mutations)
      await assertRejects({
        given:
          'an unscoped append or replacement including a purported speech claim',
        should: 'require signed capture authority',
        actual: mutation,
        code: 'CONFLICT',
      });
    assert({
      given: 'all refused unscoped transcript writes',
      should: 'leave the SQL connection untouched',
      actual: queries,
      expected: [],
    });
  });

  test('lists a segment in sequence order regardless of row order', async () => {
    const { database } = createTestDatabase([
      [
        ['u2', speakerId, 1, 'second', false, new Date(0)],
        ['u1', speakerId, 0, 'first', true, new Date(0)],
      ],
    ]);
    const lines = await database.listSegmentUtterances(segmentId);
    assert({
      given: 'rows returned out of order',
      should: 'sort them by sequence',
      actual: lines.map((line) => line.text),
      expected: ['first', 'second'],
    });
  });

  test('lists a round in insertion order', async () => {
    const { database, queries } = createTestDatabase([
      [['u1', segmentId, speakerId, 'first', true, new Date(0)]],
    ]);
    const lines = await database.listRoundUtterances(roundId);
    assert({
      given: 'the round transcript',
      should: 'read every line ordered by creation',
      actual: [lines.length, queries[0]?.query.includes('order by')],
      expected: [1, true],
    });
  });
});
