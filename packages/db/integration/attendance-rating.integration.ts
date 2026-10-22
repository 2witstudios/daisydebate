import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { readUnratedAttendanceForfeits } from '../src/attendance-rating';
import { withRatings } from './rating-fixtures';
import { validRules } from './round-fixtures';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('RT rating discovery requires committed forfeit evidence and survives consumer restart', async () => {
  await withRatings(databaseUrl, async ({ fixture, seated, rate }) => {
    const ranked = await seated();
    const casual = await seated({ competitionType: 'casual' });
    const db = drizzle({ client: fixture.sql });
    const read = () => readUnratedAttendanceForfeits(db, { limit: 100 });
    assert({
      given: 'completed ranked result without RT receipt',
      should: 'exclude unrelated completion',
      actual: await read(),
      expected: [],
    });
    const session = await fixture.sql.reserve();
    try {
      await session`begin`;
      for (const roundId of [ranked.roundId, casual.roundId]) {
        const segmentId = createId(),
          commandId = createId();
        const first = validRules.segments.find((s) => s.type === 'speech')!;
        await session`insert into round_segments(id,round_id,sequence,type,rules_segment_key,started_at,duration_ms) values(${segmentId},${roundId},0,'speech',${first.key},'2026-10-05T12:00:00Z',${first.durationMs})`;
        await session`insert into round_commands(command_id,round_id,service_id,type,payload_digest,result,resulting_version,applied_at) values(${commandId},${roundId},${`round-attendance:${createId()}`},'adjudicate',${'a'.repeat(64)},${{}},1,'2026-10-05T12:01:00Z')`;
        await session`insert into round_attendance_adjudications(segment_id,round_id,command_id,decision,effective_deadline,settled_horizon) values(${segmentId},${roundId},${commandId},'forfeit','2026-10-05T12:00:40Z','2026-10-05T12:00:45Z')`;
      }
      assert({
        given: 'writer has not committed RT receipt',
        should: 'never rate pending work',
        actual: await read(),
        expected: [],
      });
      await session`commit`;
      assert({
        given: 'committed ranked and casual RT forfeits',
        should: 'rediscover only the ranked result on every restart',
        actual: [await read(), await read()],
        expected: [[ranked.roundId], [ranked.roundId]],
      });
      const attemptId = createId();
      await fixture.sql`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,received_at,backend_pid,backend_started_at) select ${attemptId},${createId()},${ranked.roundId},${'b'.repeat(64)},${ranked.affirmative},statement_timestamp(),pid,backend_start from pg_stat_activity where pid=pg_backend_pid()`;
      assert({
        given: 'durable uncertainty on completed result',
        should: 'defer rating discovery',
        actual: await read(),
        expected: [],
      });
      await fixture.sql`update round_check_in_attempts set state='aborted',resolved_at=statement_timestamp() where attempt_id=${attemptId}`;
      await rate(ranked.roundId);
      assert({
        given: 'rating ledger committed by existing adapter',
        should: 'stop rediscovering it',
        actual: await read(),
        expected: [],
      });
    } finally {
      await session`rollback`;
      session.release();
      // Facts are immutable; only owning aggregate deletion may remove them.
      await fixture.sql`delete from rating_changes where round_id=${ranked.roundId}`;
      await fixture.sql`delete from rounds where id in (${ranked.roundId},${casual.roundId})`;
    }
  });
});
