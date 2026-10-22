import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const roundId = 'r2o8u4n6d8i1d3a5c7t9e2v4';
const segmentId = 's3e8g2m6e1n4t9i2d6c4b8k2';
const speakerId = 'p4a7r1t9i3c6i2p8a5n7t1d4';

describe('utteranceOperations', () => {
  test('exposes transcript reads without retired unscoped write or usage authority', () => {
    const { database, queries } = createTestDatabase([]);
    const retired = [
      'appendUtterance',
      'replaceUtterance',
      'claimSpeech',
      'releaseSpeech',
      'reserveAiPractice',
      'markReservationCounted',
      'countRecentAiPractice',
      'countLiveRounds',
      'recordAgentRun',
      'spokenCharactersFor',
      'reserveSpokenCharacters',
    ];
    assert({
      given: 'the shared database root after signed capture/scoped bot cutover',
      should:
        'expose only the retained transcript readers and no retired authority',
      actual: {
        retired: retired.filter((name) => Object.hasOwn(database, name)),
        readers: [
          typeof database.listSegmentUtterances,
          typeof database.listRoundUtterances,
        ],
        queries,
      },
      expected: { retired: [], readers: ['function', 'function'], queries: [] },
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
