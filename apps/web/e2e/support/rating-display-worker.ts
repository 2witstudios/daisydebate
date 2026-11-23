import { hostWaits } from '@daisy/worker/host';
import { SQL } from 'bun';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '@daisy/db';
import { affirmativeSide, negativeSide } from '@daisy/protocol/seats';
import { emptyRuntimeCheckpointFor } from '@daisy/protocol/round';
import { idSchema, ratingStyles } from '@daisy/protocol/primitives';
import { rateCompletedRound } from '../../src/features/ratings/rate-debate';
import { betaAccessTarget } from './beta-access-target';
import { seatJudges } from './seat-judges';
// Fixture-backed rendering proof, distinct from real terminal-producer journeys.
const { username, rooms } = z
  .object({
    username: z.string().regex(/^[a-z0-9-]{1,40}$/),
    rooms: z
      .array(z.object({ ladder: z.enum(ratingStyles), id: idSchema }))
      .length(ratingStyles.length),
  })
  .parse(JSON.parse(await Bun.stdin.text()));
const url = betaAccessTarget(process.env);
const sql = new SQL(url, { max: 1 });
const database = createDatabase({
  waits: hostWaits,
  url,
  nextActorId: createId,
});
try {
  const [who] = await sql`select current_user as role`;
  if (who?.role !== 'daisy_e2e')
    throw new Error('Display fixture identity refused');
  const [member] =
    await sql`select a.id from actors a join users u on u.id=a.user_id where u.username=${username}`;
  if (!member) throw new Error('Display fixture member missing');
  const opponent = createId(),
    user = createId();
  await sql`insert into users(id,username) values(${user},${`proof-${user}`})`;
  await sql`insert into actors(id,kind,user_id) values(${opponent},'human',${user})`;
  const evidence = [];
  for (const ladder of ratingStyles) {
    const id = createId(),
      command = createId();
    const roomId = rooms.find((r) => r.ladder === ladder)!.id;
    const lobbyId = await sql.begin(async (tx) => {
      const [room] =
        await tx`select rules_snapshot from rooms where id=${roomId} and host_actor_id=${member.id}`;
      if (!room) throw new Error('Display fixture room missing');
      const checkpoint = emptyRuntimeCheckpointFor(room.rules_snapshot);
      const [pool] =
        await tx`select ld.id as ladder_id, s.id as season_id, s.lobby_id, l.age_rule
        from rooms r join lobbies l on l.id=r.lobby_id and l.kind='standing'
        join seasons s on s.lobby_id=l.id and s.status='active'
        join ladders ld on ld.lobby_id=l.id where r.id=${roomId}
        order by ld.created_at,ld.id limit 1`;
      if (!pool) throw new Error('Display fixture season missing');
      await tx`insert into rounds(id,room_id,created_by_actor_id,room_config_snapshot,visibility,
        resolution,competition_type,format_id,format_version,preset_version,rules_snapshot,runtime_state,
        status,current_stage,ladder_id,season_id,rating_lobby_id,standing_age_rule,standing_youth_cast,started_at)
        select ${id},id,host_actor_id,config,visibility,'Fixture display proof','ranked',format_id,
          format_version,preset_version,rules_snapshot,${checkpoint},'active','live',${pool.ladder_id},
          ${pool.season_id},${pool.lobby_id},${pool.age_rule},coalesce(public.daisy_room_is_youth(id), false),
          clock_timestamp()-interval '10 minutes'
        from rooms where id=${roomId} and host_actor_id=${member.id}`;
      for (const [side, actor] of [
        [affirmativeSide, member.id],
        [negativeSide, opponent],
      ])
        await tx`insert into round_participants(id,round_id,actor_id,seat_kind,side,slot) values(${createId()},${id},${actor},'side',${side},0)`;
      await seatJudges(tx as never, id, room.rules_snapshot.seats?.judges ?? 0);
      // The cast is seated while the Round is constructed, then it completes
      // (round_participants_fixed_cast).
      await tx`update rounds set status='completed',current_stage=null,winning_side=${affirmativeSide},completed_at=clock_timestamp()-interval '10 minutes' where id=${id}`;
      await tx`insert into round_commands(command_id,round_id,actor_id,type,payload_digest,result,resulting_version,applied_at) values(${command},${id},${member.id},'forfeit',${'a'.repeat(64)},${{}},1,clock_timestamp())`;
      await tx`insert into round_finalizations(round_id,command_id,resulting_version) values(${id},${command},1)`;
      return String(pool.lobby_id);
    });
    const result = await rateCompletedRound(database, id, { next: createId });
    if (result.kind !== 'rated')
      throw new Error(`Display fixture did not post a rating: ${result.kind}`);
    // Long past the ranked delay: the standings hold a result until it has left.
    const [posted] = await sql.begin(async (tx) => {
      await tx`select set_config('daisy.lobby_scope',${lobbyId},true)`;
      await tx`update rating_changes set occurred_at=clock_timestamp()-interval '10 minutes' where round_id=${id}`;
      return tx`select rating_before,rating_after from rating_changes where round_id=${id} and actor_id=${member.id}`;
    });
    if (!posted)
      throw new Error(
        'Display fixture posting is absent from its lobby ledger',
      );
    evidence.push({
      ladder,
      roundId: id,
      rating: Math.round(Number(posted.rating_after)),
      delta: Math.round(
        Number(posted.rating_after) - Number(posted.rating_before),
      ),
    });
  }
  process.stdout.write(JSON.stringify(evidence));
} finally {
  await database.close();
  await sql.close();
}
