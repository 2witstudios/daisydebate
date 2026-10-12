import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { buildDebateTopic } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withSql } from './fixtures';
import { withPractice } from './ai-debate.test-support';

setupRitewayBun();
requireTestServices(process.env);

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

test('a real lock wait crossing into a later same-side speech refuses the original yield target atomically', async () => {
  await withPractice(async ({ actorId, id, operations, database }) => {
    const initial = await database.getRound(id);
    if (!initial) throw new Error('Round missing');
    const rules = {
      ...initial.rules,
      countdownMs: 0,
      segments: initial.rules.segments.map((segment) => ({
        ...segment,
        durationMs: 500,
      })),
    };
    await withSql(async (sql) => {
      await sql.unsafe(
        'update rounds set rules_snapshot = $1::jsonb, started_at = clock_timestamp() where id = $2',
        [rules, id],
      );
    });
    const view = await operations.view({ actorId, id });
    const before = await database.getRound(id);
    const persistenceCounts = () =>
      withSql(async (sql) => {
        const [row] =
          await sql`select (select count(*) from round_commands where round_id = ${id}) as commands, (select count(*) from outbox where topic = ${buildDebateTopic(id)}) as signals`;
        return row;
      });
    const counts = await persistenceCounts();
    const apply = database.applyRoundExecution;
    database.applyRoundExecution = async (input) => {
      if (input.command === null) return apply(input);
      await withSql(async (sql) => {
        const blocker = await sql.reserve();
        let executing: Promise<void> | undefined;
        try {
          await blocker`begin`;
          await blocker`select id from rounds where id = ${id} for update`;
          executing = apply(input);
          let waited = false;
          for (let attempt = 0; attempt < 500 && !waited; attempt += 1) {
            const [row] =
              await sql`select exists(select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%rounds%') as waiting`;
            waited = row.waiting;
          }
          assert({
            given: 'the application command waiting for its Round row',
            should: 'observe the actual database lock wait',
            actual: waited,
            expected: true,
          });
          const laterSpeechAt = new Date(
            Date.parse(before!.segments[0]!.startedAt) + 2_000,
          );
          // An explicit PostgreSQL-time barrier holds the already-observed row lock
          // until the later speech is due; no guessed application sleep.
          await sql`select pg_sleep_until(${laterSpeechAt})`;
          const [boundary] =
            await sql`select clock_timestamp() >= ${laterSpeechAt} as crossed`;
          if (!boundary.crossed)
            throw new Error('Clock did not reach the target boundary');
          await blocker`commit`;
          await executing;
        } finally {
          await blocker`rollback`;
          blocker.release();
          await executing?.catch(() => undefined);
        }
      });
    };
    await assertRejects({
      given: 'an AC yield locked until affirmative1AR opens',
      should: 'refuse the stale target at trusted execution time',
      actual: () =>
        operations.command({
          actorId,
          id,
          command: { type: 'yield', segmentIndex: 0 },
          expectedVersion: view.version,
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the refused lock-delayed command',
      should: 'persist no interval, command, revision or signal changes',
      actual: await database.getRound(id),
      expected: before,
    });
    assert({
      given: 'the same refused command transaction',
      should: 'append no command receipt or invalidation',
      actual: await persistenceCounts(),
      expected: counts,
    });
  });
});
