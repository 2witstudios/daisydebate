import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { ratingAwaited } from '@daisy/debate-engine';
import { readRatingCandidates, readRatingFacts } from '../src/rating-discovery';
import { withRatings } from './rating-fixtures';
import { validRules } from './round-fixtures';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('RT rating discovery requires committed forfeit evidence and survives consumer restart', async () => {
  await withRatings(databaseUrl, async ({ fixture, seated, rate }) => {
    const ranked = await seated({ terminalEvidence: false });
    const casual = await seated({ competitionType: 'casual' });
    const db = drizzle({ client: fixture.sql });
    const read = async () =>
      (await readRatingCandidates(db, { limit: 100 }))
        .filter(({ facts }) => facts !== null && ratingAwaited(facts))
        .map(({ roundId }) => roundId);
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
        await session`insert into round_finalizations(round_id,command_id,resulting_version) values(${roundId},${commandId},1)`;
        await session`insert into round_attendance_adjudications(evidence,segment_id,round_id,command_id,decision,effective_deadline,settled_horizon) values('settled_availability',${segmentId},${roundId},${commandId},'forfeit','2026-10-05T12:00:40Z','2026-10-05T12:00:45Z')`;
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

test('the writer answers a typed reason for a Round the engine leaves unrated', async () => {
  await withRatings(databaseUrl, async ({ fixture, seated, rate }) => {
    const unrecorded = await seated({ terminalEvidence: false });
    assert({
      given: 'a completed ranked Round with no finalization record',
      should: 'leave it unrated with no ledger, not throw',
      actual: await rate(unrecorded.roundId),
      expected: { kind: 'unrated', reason: 'ending-unrecorded' },
    });
    const noResult = await seated();
    await fixture.sql`update rounds set winning_side=null where id=${noResult.roundId}`;
    assert({
      given: 'a completed ranked Round whose outcome is null (DEC-277)',
      should: 'leave it unrated, never a thrown conflict',
      actual: await rate(noResult.roundId),
      expected: { kind: 'unrated', reason: 'no-result' },
    });
  });
});

test('rating discovery isolates a corrupt ledger and an unreadable completion', async () => {
  await withRatings(databaseUrl, async ({ fixture, seated }) => {
    const ledger = await seated();
    const completion = await seated();
    const good = await seated();
    await fixture.sql`update rounds set rules_snapshot =
      jsonb_set(rules_snapshot, '{segments}', '[{"type":"speech"}]'::jsonb)
      where id=${ledger.roundId}`;
    // PostgreSQL can store infinity, but to_char cannot represent it as an instant.
    await fixture.sql`update rounds set completed_at = 'infinity'
      where id=${completion.roundId}`;
    const db = drizzle({ client: fixture.sql });
    const page = await readRatingCandidates(db, { limit: 100 });
    assert({
      given:
        'two unreadable endings and one well-formed candidate in PostgreSQL',
      should: 'keep both bad Round IDs and continue returning the good facts',
      actual: [ledger, completion, good].map(({ roundId }) => {
        const candidate = page.find((item) => item.roundId === roundId);
        return candidate?.facts === null
          ? 'unreadable'
          : candidate?.facts !== undefined;
      }),
      expected: ['unreadable', 'unreadable', true],
    });
    await assertRejects({
      given: 'the corrupt ledger read on its own',
      should: 'refuse it as an invariant failure',
      actual: () => readRatingFacts(db, ledger.roundId),
      code: 'INVARIANT',
    });
  });
});
