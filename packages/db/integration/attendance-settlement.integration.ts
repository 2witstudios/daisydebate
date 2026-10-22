import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { withFixture } from './constraint-helpers';
import { validRules } from './round-fixtures';
import { assertRoundAttendanceSettled } from '../src/attendance-settlement';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const now = '2026-10-22T00:01:00.000Z';

test('judged completion cannot pass unresolved actual attendance or pending check-in evidence', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const roundId = await fixture.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date('2026-10-22T00:00:00.000Z'),
    });
    const db = drizzle({ client: fixture.sql });
    const segmentId = createId();
    const first = validRules.segments.find((s) => s.type === 'speech')!;
    await fixture.insert('round_segments', {
      id: segmentId,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: first.key,
      started_at: new Date('2026-10-22T00:00:00.000Z'),
      duration_ms: first.durationMs,
    });
    try {
      await assertRejects({
        given: 'actual prior speech has no immutable attendance resolution',
        should: 'rollback a proposed completion transaction',
        actual: () =>
          db.transaction(async (tx) => {
            await tx.execute(
              sql`update rounds set version=version+1 where id=${roundId}`,
            );
            await assertRoundAttendanceSettled(tx, { roundId, now });
          }),
        code: 'CONFLICT',
      });
      assert({
        given: 'refused completion',
        should: 'preserve durable Round version',
        actual: (
          await fixture.sql`select version from rounds where id=${roundId}`
        )[0].version,
        expected: 1,
      });
      const commandId = createId();
      await fixture.insert(
        'round_commands',
        {
          command_id: commandId,
          round_id: roundId,
          service_id: `round-attendance:${createId()}`,
          type: 'adjudicate',
          payload_digest: 'a'.repeat(64),
          result: {},
          resulting_version: 1,
          applied_at: new Date(now),
        },
        'command_id',
      );
      await fixture.sql`insert into round_attendance_adjudications(round_id,segment_id,command_id,decision,effective_deadline,settled_horizon) values(${roundId},${segmentId},${commandId},'attended','2026-10-22T00:00:40Z','2026-10-22T00:00:45Z')`;
      await db.transaction((tx) =>
        assertRoundAttendanceSettled(tx, { roundId, now }),
      );
      const actorId = await fixture.actor();
      const attemptId = createId();
      await fixture.sql`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,received_at,backend_pid,backend_started_at)
    select ${attemptId},${createId()},${roundId},${'b'.repeat(64)},${actorId},statement_timestamp(),pid,backend_start from pg_stat_activity where pid=pg_backend_pid()`;
      await assertRejects({
        given: 'resolved speech but one durable pending check-in marker',
        should: 'still refuse judged completion',
        actual: () =>
          db.transaction((tx) =>
            assertRoundAttendanceSettled(tx, { roundId, now }),
          ),
        code: 'CONFLICT',
      });
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
});
