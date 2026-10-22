import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createAttendanceRatingSweep } from '../src/features/attendance/rating';
import { withAttendanceRound } from './attendance.test-support';
import { rateDebate, ratingPolicy } from '@daisy/debate-engine';
setupRitewayBun();

/** Historical PG fixture only: tests settlement/rating, not live public-probe health. */
async function settleFixture(
  input: Parameters<Parameters<typeof withAttendanceRound>[0]>[0],
  present: boolean,
  ranked: boolean,
) {
  const { f, roundId, segmentId } = input;
  const round = (await f.store.getRound(roundId))!;
  const seasonId = createId();
  await f.sql`insert into seasons(id,name,starts_at,status) values(${seasonId},'RT rating fixture','2000-01-01T00:00:00Z','active')`;
  const preset = ranked
    ? await f.sql`insert into format_presets(format_id,length,version,format_version,config,approved_at) select format_id,length,1,format_version,config,statement_timestamp() from rooms where id=(select room_id from rounds where id=${roundId}) on conflict do nothing returning format_id`
    : [];
  if (ranked)
    await f.sql`update rounds set competition_type='ranked',preset_version=1,ladder_id='ranked' where id=${roundId}`;
  await f.sql`update rounds set started_at=started_at-interval '50 seconds' where id=${roundId}`;
  await f.sql`update round_segments set started_at=started_at-interval '50 seconds' where id=${segmentId}`;
  const samples = await f.sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(59003)`;
    return tx`insert into availability_samples(at,healthy,cause) select s.started_at+n*interval '1 second',true,null from round_segments s cross join generate_series(-1,50) n where s.id=${segmentId} order by n returning to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`;
  });
  if (present) {
    const commandId = createId();
    const seat = round.participants.find((p) => p.actorId === f.guest.actorId)!;
    await f.sql`insert into round_commands(command_id,round_id,actor_id,type,payload_digest,result,resulting_version,applied_at) values(${commandId},${roundId},${seat.actorId},'check_in',${'a'.repeat(64)},${{}},1,statement_timestamp())`;
    await f.sql`insert into round_check_ins(command_id,round_id,segment_id,participant_id,received_at) select ${commandId},${roundId},id,${seat.id},started_at+interval '1 second' from round_segments where id=${segmentId}`;
  }
  return async () => {
    await f.sql`delete from rating_changes where round_id=${roundId}`;
    for (const participant of round.participants)
      await f.sql`delete from ratings where actor_id=${participant.actorId}`;
    for (const sample of samples)
      await f.sql`delete from availability_samples where at=${sample.at}::timestamptz`;
    await f.sql`delete from outbox where topic=${`debate:${roundId}`}`;
    await f.sql`delete from rounds where id=${roundId}`;
    await f.sql`delete from seasons where id=${seasonId}`;
    if (preset.length)
      await f.sql`delete from format_presets where format_id=${round.formatId} and length='full' and version=1`;
  };
}

test('existing rating feature rediscovers only committed ranked RT forfeits and rates exactly once', async () => {
  for (const kind of ['ranked', 'casual', 'abandoned'] as const)
    await withAttendanceRound(async (input) => {
      const { f, attendance, roundId } = input;
      const cleanup = await settleFixture(
        input,
        kind !== 'abandoned',
        kind !== 'casual',
      );
      try {
        const sweep = () =>
          createAttendanceRatingSweep({
            database: f.store,
            ids: { next: createId },
          })({ limit: 100 });
        await sweep();
        const before =
          await f.sql`select id from rating_changes where round_id=${roundId}`;
        const resolved = await attendance.evaluate(roundId);
        const committed = await f.store.getRound(roundId);
        await Promise.all([sweep(), sweep()]);
        const ledger =
          await f.sql`select rating_before,rating_after,calculation_version from rating_changes where round_id=${roundId}`;
        assert({
          given: `${kind} historical actual speech evidence through real evaluator`,
          should:
            'commit shared engine outcome before rating and preserve no-ledger cases',
          actual: {
            before: before.length,
            decision: resolved?.decision,
            status: committed?.status,
            outcome: committed?.outcome,
            ledger: ledger.length,
            rediscover: await f.store.readUnratedAttendanceForfeits({
              limit: 100,
            }),
          },
          expected: {
            before: 0,
            decision: kind === 'abandoned' ? 'abandoned' : 'forfeit',
            status: kind === 'abandoned' ? 'abandoned' : 'completed',
            outcome: kind === 'abandoned' ? null : 'negative',
            ledger: kind === 'ranked' ? 2 : 0,
            rediscover: [],
          },
        });
        if (kind === 'ranked') {
          const expected = rateDebate({
            affirmative: { state: ratingPolicy.initial, lastRatedAt: null },
            negative: { state: ratingPolicy.initial, lastRatedAt: null },
            outcome: 'negative',
            occurredAt: committed!.completedAt!,
          });
          assert({
            given:
              'committed ranked RT forfeit followed by concurrent restart sweeps',
            should: 'write the existing engine calculation exactly once',
            actual: ledger
              .map((row) => ({
                rating: row.rating_after,
                version: row.calculation_version,
              }))
              .sort((a, b) => a.rating - b.rating),
            expected: [
              expected.affirmative.after.rating,
              expected.negative.after.rating,
            ]
              .sort((a, b) => a - b)
              .map((rating) => ({
                rating,
                version: expected.calculationVersion,
              })),
          });
        }
      } finally {
        await cleanup();
      }
    });
});
