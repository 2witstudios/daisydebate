import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const at = '2026-10-03T18:00:00.000Z';

// Schema-definition column order; the driver returns rows positionally.
const debateRow = [
  'debate-1',
  'actor-1',
  'Cities should make public transit free',
  'negative',
  'wren',
  'bf_emma',
  'speech-model',
  'cx-model',
  'judge-model',
  'tts-model',
  'stt-model',
  at,
  at,
  null,
  null,
  0,
  0,
  0,
  0,
  1,
];

const uniqueViolation = () =>
  Object.assign(new Error('duplicate key'), { errno: '23505' });

describe('getAiDebate', () => {
  test('maps the debate, its commands, lines and ballot', async () => {
    const { database } = createTestDatabase([
      [debateRow],
      [
        ['debate-1', 0, 'start', at, null, null],
        ['debate-1', 1, 'startSpeech', at, null, null],
        ['debate-1', 2, 'yield', at, 3, null],
        ['debate-1', 3, 'abort', at, null, 'vendor-failure'],
      ],
      [['line-1', 'debate-1', 0, 0, 'ai', 'I affirm.', true, at]],
      [['debate-1', 'affirmative', { winner: 'affirmative' }, at]],
    ]);
    const found = await database.getAiDebate('debate-1');
    assert({
      given: 'a stored AI debate with four commands, a line and a ballot',
      should: 'return them as records',
      actual: {
        personSide: found?.personSide,
        commands: found?.commands.map((c) => ({
          type: c.type,
          turnIndex: c.type === 'yield' ? c.turnIndex : undefined,
          reason: c.type === 'abort' ? c.reason : undefined,
        })),
        utterances: found?.utterances,
        ballot: found?.ballot,
      },
      expected: {
        personSide: 'negative',
        commands: [
          { type: 'start', turnIndex: undefined, reason: undefined },
          { type: 'startSpeech', turnIndex: undefined, reason: undefined },
          { type: 'yield', turnIndex: 3, reason: undefined },
          { type: 'abort', turnIndex: undefined, reason: 'vendor-failure' },
        ],
        utterances: [
          {
            id: 'line-1',
            sequence: 0,
            turnIndex: 0,
            role: 'ai',
            text: 'I affirm.',
            complete: true,
          },
        ],
        ballot: { winner: 'affirmative', ballot: { winner: 'affirmative' } },
      },
    });
  });

  test('answers null for an unknown id', async () => {
    const { database } = createTestDatabase([[]]);
    assert({
      given: 'no stored row',
      should: 'return null',
      actual: await database.getAiDebate('missing'),
      expected: null,
    });
  });
});

describe('appendAiDebateCommand', () => {
  const command = { type: 'start' as const, at: new Date(at) };

  test('inserts at the expected sequence', async () => {
    const { database, queries } = createTestDatabase([[[0]], []]);
    await database.appendAiDebateCommand({
      aiDebateId: 'debate-1',
      expectedSequence: 0,
      command,
    });
    assert({
      given: 'an empty log and expected sequence 0',
      should: 'insert the command',
      actual: queries.some((q) =>
        q.query.startsWith('insert into "ai_debate_commands"'),
      ),
      expected: true,
    });
  });

  test('refuses a stale sequence or a lost race as a conflict', async () => {
    const stale = createTestDatabase([[[2]]]).database;
    await assertRejects({
      given: 'a log of two commands and expected sequence 1',
      should: 'refuse with CONFLICT',
      actual: () =>
        stale.appendAiDebateCommand({
          aiDebateId: 'debate-1',
          expectedSequence: 1,
          command,
        }),
      code: 'CONFLICT',
    });
    const raced = createTestDatabase([[[0]], uniqueViolation()]).database;
    await assertRejects({
      given: 'another command inserted at the same sequence first',
      should: 'refuse with CONFLICT',
      actual: () =>
        raced.appendAiDebateCommand({
          aiDebateId: 'debate-1',
          expectedSequence: 0,
          command,
        }),
      code: 'CONFLICT',
    });
  });
});

describe('lines, usage, ballot and counts', () => {
  test('a line is appended under a lock on its debate', async () => {
    const { database, queries } = createTestDatabase([[['debate-1']], []]);
    await database.appendAiDebateUtterance({
      id: 'line-1',
      aiDebateId: 'debate-1',
      turnIndex: 0,
      role: 'person',
      text: 'I affirm.',
    });
    assert({
      given: 'a new line',
      should: 'lock the debate row, then insert the line',
      actual: [
        queries[0]?.query.includes('for update'),
        queries[1]?.query.startsWith('insert into "ai_debate_utterances"'),
      ],
      expected: [true, true],
    });
  });

  test('replacing a line, recording usage and finishing are updates', async () => {
    const { database, queries } = createTestDatabase([[], [], []]);
    await database.replaceAiDebateUtterance({
      id: 'line-1',
      aiDebateId: 'debate-1',
      text: 'I affirm',
    });
    await database.recordAiDebateUsage({
      aiDebateId: 'debate-1',
      ttsCharacters: 9,
    });
    await database.finishAiDebate('debate-1');
    assert({
      given: 'three writes',
      should: 'update the line, then the debate twice',
      actual: queries.map((q) => q.query.split(' set ')[0]),
      expected: [
        'update "ai_debate_utterances"',
        'update "ai_debates"',
        'update "ai_debates"',
      ],
    });
  });

  test('the stored ballot wins', async () => {
    const { database } = createTestDatabase([
      [],
      [['debate-1', 'negative', { winner: 'negative' }, at]],
    ]);
    const saved = await database.saveAiDebateBallot({
      aiDebateId: 'debate-1',
      winner: 'affirmative',
      ballot: { winner: 'affirmative' },
    });
    assert({
      given: 'a ballot already stored',
      should: 'return the stored ruling',
      actual: saved.winner,
      expected: 'negative',
    });
  });
});

describe('createAiDebate', () => {
  const debate = {
    id: 'debate-1',
    actorId: 'actor-1',
    resolution: 'Cities should make public transit free',
    personSide: 'negative' as const,
    opponent: 'wren',
    voice: 'bf_emma',
    speechModel: 's',
    cxModel: 'c',
    judgeModel: 'j',
    ttsModel: 't',
    sttModel: 'w',
    expectedEndAt: new Date(at),
  };
  const limits = { live: 2, perDay: 3 };
  const create = (script: unknown[][]) => {
    const { database, queries } = createTestDatabase(script as never);
    return {
      queries,
      result: database.createAiDebate({ debate, now: new Date(at), limits }),
    };
  };
  const kinds = (queries: readonly { query: string }[]) =>
    queries.map((q) => q.query.split(' ').slice(0, 2).join(' '));

  test("creates under a lock, finishing the actor's open debate", async () => {
    const { queries, result } = create([[], [[0]], [[1]], [], []]);
    assert({
      given: 'room under both caps',
      should: "lock, count, finish the actor's open debate and insert",
      actual: { result: await result, kinds: kinds(queries) },
      expected: {
        result: 'created',
        kinds: [
          "select pg_advisory_xact_lock(hashtext('ai_debates.create'))",
          'select count(*)',
          'select count(*)',
          'update "ai_debates"',
          'insert into',
        ],
      },
    });
  });

  test('refuses over a cap and writes nothing', async () => {
    const daily = create([[], [[3]]]);
    const busy = create([[], [[0]], [[2]]]);
    assert({
      given: 'three debates today, then two other people already debating',
      should: 'refuse each without an update or an insert',
      actual: [
        await daily.result,
        await busy.result,
        [...daily.queries, ...busy.queries].some((q) =>
          /^(update|insert)/.test(q.query),
        ),
      ],
      expected: ['daily-limit', 'busy', false],
    });
  });
});
