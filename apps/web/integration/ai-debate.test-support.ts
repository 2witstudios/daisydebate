import { createId } from '@paralleldrive/cuid2';
import { systemId } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { createAiDebateOperations } from '../src/features/ai-debate/operations';
import type { AiDebateDependencies } from '../src/features/ai-debate/context';
import { testDatabaseUrl, withSql } from './fixtures';

type Voice = ReturnType<AiDebateDependencies['voice']>;

export const withPractice = async (
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
