import { createId } from '@paralleldrive/cuid2';
import { systemId } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAiDebateOperations } from '../src/features/ai-debate/operations';
import type { AiDebateDependencies } from '../src/features/ai-debate/context';
import { testDatabaseUrl, withSql } from './fixtures';

setupRitewayBun();
requireTestServices(process.env);

type Voice = ReturnType<AiDebateDependencies['voice']>;

const withPractice = async (
  run: (fixture: {
    database: ReturnType<typeof createDatabase>;
    actorId: string;
    id: string;
    operations: ReturnType<typeof createAiDebateOperations>;
    expireAt: (seconds: number) => Promise<void>;
    setTranscribe: (work: Voice['transcribe']) => void;
  }) => Promise<void>,
) => {
  const userId = createId();
  const actorId = createId();
  const database = createDatabase({
    url: testDatabaseUrl,
    nextActorId: createId,
  });
  let id: string | undefined;
  let roomId: string | null = null;
  let transcribe: Voice['transcribe'] = async () => ({
    text: 'My final words.',
  });
  const unused = async (): Promise<never> => {
    throw new Error('unexpected voice call');
  };
  const voice: Voice = {
    transcribe: (input) => transcribe(input),
    complete: unused,
    speak: unused,
    async *stream() {
      yield await unused();
    },
  };
  await withSql(async (sql) => {
    await sql`insert into users (id) values (${userId})`;
    await sql`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${userId})`;
  });
  try {
    const operations = createAiDebateOperations({
      store: database,
      voice: () => voice,
      ids: systemId,
    });
    ({ id } = await operations.start({
      actorId,
      resolution: 'Cities should make transit free',
      personSide: 'affirmative',
      opponent: 'wren',
    }));
    await withSql(async (sql) => {
      const [row] = await sql`select room_id from rounds where id = ${id!}`;
      roomId = row!.room_id as string;
    });
    await operations.command({
      actorId,
      id,
      command: { type: 'start' },
      expectedVersion: 1,
    });
    const roundId = id;
    await run({
      database,
      actorId,
      id,
      operations,
      expireAt: async (seconds) => {
        await withSql(async (sql) => {
          await sql`update rounds set started_at = statement_timestamp() - (${seconds} * interval '1 second') where id = ${roundId}`;
        });
      },
      setTranscribe: (work) => {
        transcribe = work;
      },
    });
  } finally {
    await database.close();
    await withSql(async (sql) => {
      if (id) {
        await sql`delete from utterances where round_id = ${id}`;
        await sql`delete from agent_runs where round_participant_id in (select id from round_participants where round_id = ${id})`;
        await sql`delete from rounds where id = ${id}`;
      }
      if (roomId) await sql`delete from rooms where id = ${roomId}`;
      await sql`delete from actors where id = ${actorId}`;
      await sql`delete from users where id = ${userId}`;
    });
  }
};

test('a returning browser materializes multiple expired intervals through PostgreSQL', async () => {
  await withPractice(async ({ actorId, id, operations, expireAt }) => {
    await expireAt(441);
    const view = await operations.view({ actorId, id });
    assert({
      given: 'the first poll 441 seconds after starting',
      should: 'retain the AC and CX1 closes in the same runtime execution',
      actual: view.segments.map((row) => [
        row.rulesSegmentKey,
        row.endedAt !== null,
      ]),
      expected: [
        ['AC', true],
        ['CX1', true],
      ],
    });
  });
});

test('a failed tick cannot complete from uncommitted runtime state', async () => {
  await withPractice(
    async ({ actorId, id, operations, database, expireAt }) => {
      await expireAt(311);
      const before = await database.getRound(id);
      const apply = database.applyRoundExecution;
      let failed = false;
      database.applyRoundExecution = async (input) => {
        if (!failed && input.command === null) {
          failed = true;
          throw createAppError('INFRASTRUCTURE');
        }
        await apply(input);
      };
      const abort = () =>
        operations.command({
          actorId,
          id,
          command: { type: 'abort' },
          expectedVersion: before!.version,
        });
      await assertRejects({
        given: 'a failed persistence call at speech expiry',
        should: 'refuse the following command without changing durable state',
        actual: abort,
        code: 'INFRASTRUCTURE',
      });
      assert({
        given: 'the refused execution',
        should: 'leave the persisted round unchanged',
        actual: await database.getRound(id),
        expected: before,
      });
      await abort();
      const after = await database.getRound(id);
      assert({
        given: 'the retry with a fresh runtime from PostgreSQL',
        should: 'complete with the caught-up speech closed',
        actual: [
          after?.status,
          after?.segments.every((row) => row.endedAt !== null),
        ],
        expected: ['completed', true],
      });
    },
  );
});

test('PostgreSQL retains final buffered audio and transcription that finishes across expiry', async () => {
  await withPractice(
    async ({ actorId, id, operations, expireAt, setTranscribe }) => {
      const clip = {
        actorId,
        id,
        segmentIndex: 0,
        audioBase64: 'QUJDRA==',
        format: 'webm' as const,
      };
      await expireAt(309);
      setTranscribe(async () => {
        await withSql(async (sql) => {
          await sql`update round_segments set started_at = started_at - interval '2 seconds' where round_id = ${id}`;
        });
        await operations.view({ actorId, id });
        return { text: 'Admitted before expiry.' };
      });
      await operations.transcribe(clip);
      setTranscribe(async () => ({ text: 'Buffered tail.' }));
      await operations.transcribe(clip);
      const view = await operations.view({ actorId, id });
      assert({
        given:
          'a live transcription crosses closure and the recorder tail arrives afterward',
        should: 'retain both lines against the closed speech',
        actual: [
          view.segments[0]?.endedAt !== null,
          view.utterances.map((line) => line.text),
        ],
        expected: [true, ['Admitted before expiry.', 'Buffered tail.']],
      });
    },
  );
});

test('AI practice operations refuse durable human-controlled seats and casual rounds', async () => {
  await withPractice(async ({ actorId, id, operations, database }) => {
    const humanUser = createId();
    const humanActor = createId();
    await withSql(async (sql) => {
      await sql`insert into users (id) values (${humanUser})`;
      await sql`insert into actors (id, kind, user_id) values (${humanActor}, 'human', ${humanUser})`;
    });
    try {
      for (const role of ['negative', 'judge'] as const) {
        const original = (await database.getRound(id))!.participants.find(
          (seat) => seat.role === role,
        )!;
        await withSql(async (sql) => {
          await sql`update round_participants set actor_id = ${humanActor} where id = ${original.id}`;
        });
        const before = await database.getRound(id);
        await assertRejects({
          given: `a practice round with a human ${role}`,
          should: 'refuse AI judging before the provider or a durable write',
          actual: () => operations.ballot({ actorId, id }),
          code: 'NOT_FOUND',
        });
        assert({
          given: 'the refused AI ballot',
          should: 'leave the durable round unchanged',
          actual: await database.getRound(id),
          expected: before,
        });
        await withSql(async (sql) => {
          await sql`update round_participants set actor_id = ${original.actorId} where id = ${original.id}`;
        });
      }
      await withSql(async (sql) => {
        await sql`update rounds set competition_type = 'casual' where id = ${id}`;
      });
      await assertRejects({
        given: 'a casual round with the AI cast',
        should: 'refuse practice commands',
        actual: () =>
          operations.command({
            actorId,
            id,
            command: { type: 'abort' },
            expectedVersion: 2,
          }),
        code: 'NOT_FOUND',
      });
    } finally {
      await withSql(async (sql) => {
        await sql`delete from round_participants where round_id = ${id} and actor_id = ${humanActor}`;
        await sql`delete from actors where id = ${humanActor}`;
        await sql`delete from users where id = ${humanUser}`;
      });
    }
  });
});
