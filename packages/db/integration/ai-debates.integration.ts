import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const models = {
  speechModel: 'anthropic/claude-sonnet-5.5',
  cxModel: 'openai/gpt-6-luna',
  judgeModel: 'anthropic/claude-sonnet-5.5',
  ttsModel: 'deepgram/aura-2',
  sttModel: 'openai/whisper-large-v3-turbo',
};

/** Limits no test here comes near unless it means to. */
const roomy = { live: 1_000_000, perDay: 1_000_000 };

const newDebate = (id: string, actorId: string, expectedEndAt: Date) => ({
  id,
  actorId,
  resolution: 'Social media does more harm than good',
  personSide: 'negative' as const,
  opponent: 'wren',
  voice: 'aura-2-thalia-en',
  expectedEndAt,
  ...models,
});

const withDebate = async (
  run: (input: {
    database: ReturnType<typeof createDatabase>;
    id: string;
    actorId: string;
  }) => Promise<void>,
) =>
  withFixture(url, async (fixture) => {
    const actorId = await fixture.actor(await fixture.user());
    const database = createDatabase({ url, nextActorId: createId });
    const id = createId();
    fixture.track('ai_debates', id);
    try {
      await database.createAiDebate({
        debate: newDebate(id, actorId, new Date(Date.UTC(2026, 9, 3, 19))),
        now: new Date(Date.UTC(2026, 9, 3, 18)),
        limits: roomy,
      });
      await run({ database, id, actorId });
    } finally {
      await database.close();
    }
  });

describe('AI debates (AIDB-3.1)', () => {
  test('a created AI debate reads back with an empty log', async () => {
    await withDebate(async ({ database, id, actorId }) => {
      const found = await database.getAiDebate(id);
      assert({
        given: 'a new AI debate',
        should: 'read back its setup, no commands, utterances or ballot',
        actual: {
          actorId: found?.actorId,
          personSide: found?.personSide,
          countedAt: found?.countedAt,
          commands: found?.commands,
          utterances: found?.utterances,
          ballot: found?.ballot,
        },
        expected: {
          actorId,
          personSide: 'negative',
          countedAt: null,
          commands: [],
          utterances: [],
          ballot: null,
        },
      });
    });
  });

  test('commands append in sequence and a stale sequence is refused', async () => {
    await withDebate(async ({ database, id }) => {
      const at = new Date(Date.UTC(2026, 9, 3, 18));
      await database.appendAiDebateCommand({
        aiDebateId: id,
        expectedSequence: 0,
        command: { type: 'start', at },
      });
      await assertRejects({
        given: 'a second command claiming sequence 0',
        should: 'refuse it as a conflict',
        actual: () =>
          database.appendAiDebateCommand({
            aiDebateId: id,
            expectedSequence: 0,
            command: { type: 'yield', at, turnIndex: 0 },
          }),
        code: 'CONFLICT',
      });
      await database.appendAiDebateCommand({
        aiDebateId: id,
        expectedSequence: 1,
        command: { type: 'yield', at, turnIndex: 0 },
      });
      const found = await database.getAiDebate(id);
      assert({
        given: 'a start and a yield',
        should: 'read back both commands in order',
        actual: found?.commands.map((command) => command.type),
        expected: ['start', 'yield'],
      });
    });
  });

  test('utterances, usage and the ballot', async () => {
    await withDebate(async ({ database, id }) => {
      await database.appendAiDebateUtterance({
        id: createId(),
        aiDebateId: id,
        turnIndex: 0,
        role: 'ai',
        text: 'I affirm.',
      });
      const second = createId();
      await database.appendAiDebateUtterance({
        id: second,
        aiDebateId: id,
        turnIndex: 1,
        role: 'person',
        text: 'Why?',
      });
      await database.replaceAiDebateUtterance({
        id: second,
        aiDebateId: id,
        text: 'Why so?',
      });
      await database.recordAiDebateUsage({
        aiDebateId: id,
        ttsCharacters: 9,
        promptTokens: 100,
      });
      const ballot = { winner: 'negative', reason: 'r' };
      const saved = await database.saveAiDebateBallot({
        aiDebateId: id,
        winner: 'negative',
        ballot,
      });
      const again = await database.saveAiDebateBallot({
        aiDebateId: id,
        winner: 'affirmative',
        ballot: { winner: 'affirmative' },
      });
      const found = await database.getAiDebate(id);
      assert({
        given: 'two utterances, one replaced',
        should: 'read them back in order with the replacement',
        actual: found?.utterances.map((u) => [u.sequence, u.role, u.text]),
        expected: [
          [0, 'ai', 'I affirm.'],
          [1, 'person', 'Why so?'],
        ],
      });
      assert({
        given: 'recorded usage',
        should: 'add it and start counting the debate',
        actual: {
          tts: found?.ttsCharacters,
          prompt: found?.promptTokens,
          counted: found?.countedAt instanceof Date,
        },
        expected: { tts: 9, prompt: 100, counted: true },
      });
      assert({
        given: 'a ballot saved twice',
        should: 'keep the first ruling',
        actual: [saved.winner, again.winner, found?.ballot?.winner],
        expected: ['negative', 'negative', 'negative'],
      });
    });
  });

  test('lines appended at the same moment all land, in some order', async () => {
    await withDebate(async ({ database, id }) => {
      await Promise.all(
        [0, 1, 2, 3, 4, 5].map((n) =>
          database.appendAiDebateUtterance({
            id: createId(),
            aiDebateId: id,
            turnIndex: 1,
            role: n % 2 ? 'ai' : 'person',
            text: `line ${n}`,
          }),
        ),
      );
      const found = await database.getAiDebate(id);
      assert({
        given: 'six lines appended concurrently',
        should: 'keep all six with distinct sequences',
        actual: found?.utterances.map((u) => u.sequence),
        expected: [0, 1, 2, 3, 4, 5],
      });
    });
  });

  test('a burst of voice requests never overshoots the speech budget', async () => {
    await withDebate(async ({ database, id }) => {
      const results = await Promise.all(
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(() =>
          database.reserveAiDebateSpeech({
            aiDebateId: id,
            characters: 100,
            budget: 350,
          }),
        ),
      );
      const found = await database.getAiDebate(id);
      assert({
        given: 'ten 100-character reservations at once against a budget of 350',
        should:
          'grant exactly three, count 300 characters and start counting the debate',
        actual: {
          granted: results.filter(Boolean).length,
          counted: found?.ttsCharacters,
          started: found?.countedAt instanceof Date,
        },
        expected: { granted: 3, counted: 300, started: true },
      });
    });
  });

  test('a burst of starts never overshoots the live cap', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      // Far in the future, so no other suite's debate is still open.
      const now = new Date(Date.UTC(2100, 0, 1));
      try {
        const actors = await Promise.all(
          [0, 1, 2, 3, 4, 5, 6, 7].map(async () =>
            fixture.actor(await fixture.user()),
          ),
        );
        const results = await Promise.all(
          actors.map((actorId) => {
            const id = createId();
            fixture.track('ai_debates', id);
            return database.createAiDebate({
              debate: newDebate(id, actorId, new Date(now.getTime() + 60_000)),
              now,
              limits: { live: 3, perDay: 10 },
            });
          }),
        );
        assert({
          given: 'eight people starting at once with a live cap of three',
          should: 'create exactly three and refuse the rest as busy',
          actual: [
            results.filter((r) => r === 'created').length,
            results.filter((r) => r === 'busy').length,
          ],
          expected: [3, 5],
        });
      } finally {
        await database.close();
      }
    });
  });

  test('a person holds one live debate, within a daily cap', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      const now = new Date();
      const actorId = await fixture.actor(await fixture.user());
      const start = async () => {
        const id = createId();
        fixture.track('ai_debates', id);
        const result = await database.createAiDebate({
          debate: newDebate(id, actorId, new Date(now.getTime() + 60_000)),
          now,
          limits: { live: 1_000_000, perDay: 2 },
        });
        return { id, result };
      };
      try {
        const first = await start();
        const second = await start();
        const third = await start();
        const [a, b] = await Promise.all([
          database.getAiDebate(first.id),
          database.getAiDebate(second.id),
        ]);
        assert({
          given:
            'a person starting two debates, then a third over a daily cap of two',
          should: 'finish the first, keep the second open, refuse the third',
          actual: [
            a?.finishedAt instanceof Date,
            b?.finishedAt,
            third.result,
            await database.getAiDebate(third.id),
          ],
          expected: [true, null, 'daily-limit', null],
        });
      } finally {
        await database.close();
      }
    });
  });
});
