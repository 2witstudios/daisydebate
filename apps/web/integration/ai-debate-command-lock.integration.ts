import { requireTestServices } from '@daisy/config';
import { buildDebateTopic } from '@daisy/protocol';
import { roundPositionAt } from '@daisy/debate-engine/position';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withSql } from './fixtures';
import { withPractice } from './ai-debate.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a real lock wait crossing into a later same-side speech refuses the original yield target atomically', async () => {
  await withPractice(async ({ actorId, id, operations, database }) => {
    const initial = await database.getRound(id);
    if (!initial) throw new Error('Round missing');
    const rules = {
      ...initial.rules,
      countdownMs: 0,
      segments: initial.rules.segments.map((segment, sequence) => ({
        ...segment,
        durationMs: sequence === 0 ? 2_000 : sequence < 4 ? 10 : 5_000,
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
    if (!before) throw new Error('Round missing');
    const targetSequence = rules.segments.findIndex(
      (segment, sequence) =>
        sequence > 0 &&
        segment.type === 'speech' &&
        segment.side === rules.segments[0]!.side,
    );
    if (targetSequence < 0)
      throw new Error('A later same-side speech is required');
    const untilTargetMs = rules.segments
      .slice(0, targetSequence)
      .reduce(
        (elapsed, segment) => elapsed + segment.durationMs + rules.countdownMs,
        0,
      );
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
          const opening = before.segments[0]!;
          const [admitted] = await blocker`select clock_timestamp() as now`;
          assert({
            given:
              'the command admitted while its original AC target is still live',
            should:
              'prove the setup precondition before starting the blocked writer',
            actual:
              admitted.now.getTime() <
              Date.parse(opening.startedAt) + opening.durationMs,
            expected: true,
          });
          // Finish setup before approaching a bounded lock window, so the
          // blocked operation (about 130ms: 100ms plus three 10ms segments)
          // stays inside the 200ms runtime lock timeout.
          const lockFrom = new Date(
            Date.parse(opening.startedAt) + opening.durationMs - 100,
          );
          await blocker`select pg_sleep_until(${lockFrom})`;
          executing = apply({
            ...input,
            buildProjection: (trustedNow) => {
              const atExecution = roundPositionAt({
                round: before,
                rules,
                segments: before.segments,
                checkpoint: before.checkpoint,
                nowMs: Date.parse(trustedNow),
              });
              assert({
                given:
                  'the post-lock database instant after the actual boundary wait',
                should:
                  'reach the later speech held by the same scheduled side',
                actual: [
                  atExecution.openSegment?.sequence,
                  atExecution.openSegment?.side,
                ],
                expected: [targetSequence, rules.segments[0]!.side],
              });
              return input.buildProjection(trustedNow);
            },
          });
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
            Date.parse(opening.startedAt) + untilTargetMs,
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
