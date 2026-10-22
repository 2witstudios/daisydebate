import { buildDebateTopic } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import type { withAttendanceRound } from './attendance.test-support';

/** Historical PG fixture only: tests settlement/rating, not live public-probe health. */
export async function settleAttendanceFixture(
  input: Pick<
    Parameters<Parameters<typeof withAttendanceRound>[0]>[0],
    'f' | 'roundId' | 'segmentId'
  >,
  present: boolean,
  ranked: boolean,
  presentActorId = input.f.guest.actorId,
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
    const seat = round.participants.find((p) => p.actorId === presentActorId)!;
    await f.sql`insert into round_commands(command_id,round_id,actor_id,type,payload_digest,result,resulting_version,applied_at) values(${commandId},${roundId},${seat.actorId},'check_in',${'a'.repeat(64)},${{}},1,statement_timestamp())`;
    await f.sql`insert into round_check_ins(command_id,round_id,segment_id,participant_id,received_at) select ${commandId},${roundId},id,${seat.id},started_at+interval '1 second' from round_segments where id=${segmentId}`;
  }
  return async () => {
    await f.sql`delete from rating_changes where round_id=${roundId}`;
    for (const participant of round.participants)
      await f.sql`delete from ratings where actor_id=${participant.actorId}`;
    for (const sample of samples)
      await f.sql`delete from availability_samples where at=${sample.at}::timestamptz`;
    await f.sql`delete from outbox where topic=${buildDebateTopic(roundId)}`;
    await f.sql`delete from rounds where id=${roundId}`;
    await f.sql`delete from seasons where id=${seasonId}`;
    if (preset.length)
      await f.sql`delete from format_presets where format_id=${round.formatId} and length='full' and version=1`;
  };
}
