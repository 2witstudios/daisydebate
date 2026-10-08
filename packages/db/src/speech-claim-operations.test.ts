import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const roundId = 'r2o8u4n6d8i1d3a5c7t9e2v4';
const segmentId = 's3e8g2m6e1n4t9i2d6c4b8k2';
const seatId = 'p4a7r1t9i3c6i2p8a5n7t1d4';
const lineId = 'u3t2t6e1r9a4n8c5e7i2d6p1';
const now = new Date('2026-10-08T00:00:00.000Z');
const input = {
  id: lineId,
  roundId,
  segmentId,
  roundParticipantId: seatId,
  token: 'writer-1',
};

describe('speech generation claims', () => {
  test('creates one incomplete line after locking a live speech segment', async () => {
    const { database, queries } = createTestDatabase([
      [[null, 'speech']],
      [{ now }],
      [],
      [],
    ]);
    const claimed = await database.claimSpeech(input);
    assert({
      given: 'an empty live speech segment',
      should: 'reserve its line under the segment lock',
      actual: {
        claimed,
        locked: queries[0]?.query.includes('for update'),
        inserted: queries[3]?.query.includes('insert into "utterances"'),
      },
      expected: {
        claimed: { status: 'claimed', utteranceId: lineId },
        locked: true,
        inserted: true,
      },
    });
  });

  test('holds an active claim and replays a completed line without writing', async () => {
    const held = createTestDatabase([
      [[null, 'speech']],
      [{ now }],
      [[lineId, false, new Date(now.getTime() + 60_000)]],
    ]);
    const complete = createTestDatabase([
      [[null, 'speech']],
      [{ now }],
      [[lineId, true, null]],
    ]);
    assert({
      given: 'one active writer and one already-complete speech',
      should: 'make neither request write another line',
      actual: [
        await held.database.claimSpeech(input),
        await complete.database.claimSpeech(input),
        held.queries.length,
        complete.queries.length,
      ],
      expected: [
        { status: 'held', utteranceId: lineId },
        { status: 'complete', utteranceId: lineId },
        3,
        3,
      ],
    });
  });

  test('takes over an expired claim on the same line and releases by token', async () => {
    const { database, queries } = createTestDatabase([
      [[null, 'speech']],
      [{ now }],
      [[lineId, false, new Date(now.getTime() - 1)]],
      [],
      [],
    ]);
    const claimed = await database.claimSpeech(input);
    await database.releaseSpeech({
      utteranceId: lineId,
      roundId,
      token: input.token,
    });
    assert({
      given: 'an expired writer on an incomplete speech',
      should: 'reuse its line and clear only the matching token on release',
      actual: {
        claimed,
        updated: queries[3]?.query.includes('update "utterances"'),
        releasedByToken: queries[4]?.query.includes('generation_token'),
      },
      expected: {
        claimed: { status: 'claimed', utteranceId: lineId },
        updated: true,
        releasedByToken: true,
      },
    });
  });
});
