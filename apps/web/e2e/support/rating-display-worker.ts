import { SQL } from 'bun';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '@daisy/db';
import { validRules } from '@daisy/db/testing';
import { ratingLadders } from '@daisy/protocol';
import { rateCompletedRound } from '../../src/features/ratings/rate-debate';
import { betaAccessTarget } from './beta-access-target';
// Fixture-backed rendering proof, distinct from real terminal-producer journeys.
const { username } = z
  .object({ username: z.string().regex(/^[a-z0-9-]{1,40}$/) })
  .parse(JSON.parse(await Bun.stdin.text()));
const url = betaAccessTarget(process.env);
const sql = new SQL(url, { max: 1 });
const database = createDatabase({ url, nextActorId: createId });
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
  for (const ladder of ratingLadders) {
    const id = createId(),
      command = createId();
    await sql.begin(async (tx) => {
      await tx`insert into rounds(id,resolution,competition_type,format_id,format_version,preset_version,rules_snapshot,status,outcome,ladder_id,started_at,completed_at) values(${id},'Fixture display proof','ranked',${ladder},1,1,${validRules},'completed','affirmative',${ladder},clock_timestamp(),clock_timestamp())`;
      for (const [role, actor] of [
        ['affirmative', member.id],
        ['negative', opponent],
      ])
        await tx`insert into round_participants(id,round_id,actor_id,role,slot) values(${createId()},${id},${actor},${role},0)`;
      await tx`insert into round_commands(command_id,round_id,actor_id,type,payload_digest,result,resulting_version,applied_at) values(${command},${id},${member.id},'forfeit',${'a'.repeat(64)},${{}},1,clock_timestamp())`;
      await tx`insert into round_finalizations(round_id,command_id,resulting_version) values(${id},${command},1)`;
    });
    await rateCompletedRound(database, id, { next: createId });
    const [posted] =
      await sql`select rating_before,rating_after from rating_changes where round_id=${id} and actor_id=${member.id}`;
    evidence.push({
      ladder,
      roundId: id,
      rating: Math.round(Number(posted!.rating_after)),
      delta: Math.round(
        Number(posted!.rating_after) - Number(posted!.rating_before),
      ),
    });
  }
  process.stdout.write(JSON.stringify(evidence));
} finally {
  await database.close();
  await sql.close();
}
