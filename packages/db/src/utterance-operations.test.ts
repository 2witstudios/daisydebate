import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const roundId = 'r2o8u4n6d8i1d3a5c7t9e2v4';
const segmentId = 's3e8g2m6e1n4t9i2d6c4b8k2';
const speakerId = 'p4a7r1t9i3c6i2p8a5n7t1d4';

describe('utteranceOperations', () => {
  test('appends a line under a lock on its segment row', async () => {
    const { database, queries } = createTestDatabase([[['segment-1']], []]);
    await database.appendUtterance({
      id: 'u1',
      roundId,
      segmentId,
      roundParticipantId: speakerId,
      text: 'The first constructive.',
      requireOpen: false,
    });
    assert({
      given: 'an appended line',
      should: 'lock the segment row, then insert with the next sequence',
      actual: [
        queries[0]?.query.includes('for update'),
        queries[1]?.query.includes('insert into "utterances"'),
        queries[1]?.query.includes('coalesce(max'),
      ],
      expected: [true, true, true],
    });
  });

  test('replaces a line within its round, with or without completeness', async () => {
    const { database, queries } = createTestDatabase([[], []]);
    await database.replaceUtterance({
      id: 'u1',
      roundId,
      text: 'The heard words.',
      requireOpen: false,
    });
    await database.replaceUtterance({
      id: 'u1',
      roundId,
      text: 'The whole line.',
      complete: true,
      requireOpen: false,
    });
    assert({
      given: 'a replace without complete',
      should: 'set only the text',
      actual: queries[0]?.query.includes('"complete"'),
      expected: false,
    });
    assert({
      given: 'a replace with complete',
      should: 'set the text and completeness',
      actual: queries[1]?.query.includes('"complete"'),
      expected: true,
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
