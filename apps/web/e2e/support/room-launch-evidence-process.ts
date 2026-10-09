import { resolve } from 'node:path';
import { SQL } from 'bun';
import { requireLaunchSlot } from './room-launch-slot';
if (import.meta.main) {
  const slot = requireLaunchSlot(
    resolve(import.meta.dir, '../../../..'),
    process.env,
  );
  const roomId = Bun.argv[2];
  if (!roomId || !/^[a-z0-9]{20,32}$/.test(roomId))
    throw new Error('Invalid proof Room identity');
  const sql = new SQL(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx`set transaction read only`;
      const [identity] = await tx`select current_database() name`;
      if (identity!.name !== slot.database)
        throw new Error('Proof evidence target mismatch');
      const [rows] = await tx`select
        (select row_to_json(r) from rooms r where id=${roomId}) room,
        (select coalesce(json_agg(p order by id),'[]'::json) from room_participants p where room_id=${roomId}) seats,
        (select coalesce(json_agg(c order by command_id),'[]'::json) from room_commands c where room_id=${roomId}) commands,
        (select coalesce(json_agg(r order by id),'[]'::json) from rounds r where room_id=${roomId}) rounds,
        (select coalesce(json_agg(p order by id),'[]'::json) from round_participants p where round_id in (select id from rounds where room_id=${roomId})) cast,
        (select coalesce(json_agg(json_build_object('seq',seq,'payload',payload) order by seq),'[]'::json) from outbox where topic=${`room:${roomId}`}) outbox`;
      const [counts] = await tx`select
        (select count(*)::int from users) users,
        (select count(*)::int from actors) actors,
        (select count(*)::int from rooms) rooms,
        (select count(*)::int from rounds) rounds,
        (select count(*)::int from room_participants) seats,
        (select count(*)::int from round_participants) "roundSeats",
        (select count(*)::int from room_commands) commands,
        (select count(*)::int from outbox) outbox`;
      const rounds =
        await tx`select status, resolution topic, room_config_snapshot config,
        rules_snapshot rules, started_at "startedAt",
        (select array_agg(actor_id order by actor_id) from round_participants where round_id=r.id) cast
        from rounds r where room_id=${roomId} order by id`;
      const [bells] =
        await tx`select count(*)::int count from outbox where topic=${`room:${roomId}`} and payload->>'entityVersion'=(select change_version::text from rooms where id=${roomId})`;
      const hash = new Bun.CryptoHasher('sha3-256')
        .update(JSON.stringify(rows))
        .digest('hex');
      process.stdout.write(
        JSON.stringify({
          hash,
          counts,
          frozen: rounds,
          launchDoorbells: bells!.count,
        }),
      );
    });
  } finally {
    await sql.close();
  }
}
