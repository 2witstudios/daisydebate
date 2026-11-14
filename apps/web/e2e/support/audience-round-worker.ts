import { createHash } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { validRules, publicLobbyId } from '@daisy/db/testing';
import { SQL } from 'bun';
import { betaAccessTarget } from './beta-access-target';

/**
 * A Round on air, plus one stored notification and one watched Round for the
 * account named. Its Broadcast's watermark is ahead of now, so its resolution is
 * out, unless `held`: then nothing has been released, and what the spec reads of
 * the audience proves the audience is not on that timeline. Same isolated e2e
 * boundary as beta approval.
 *
 * `seat <username> <roundId> <role>` puts an account in an existing Round's live
 * room; `host` names who hosts it, seatless, and `link` makes it unlisted.
 */
const [username, ...options] = process.argv.slice(2);
if (!username) throw new Error('Name the account');
const option = (name: string) =>
  options.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const client = new SQL(betaAccessTarget(process.env), { max: 1 });
try {
  const [identity] = await client`select current_user as role`;
  if (identity?.role !== 'daisy_e2e') throw new Error('Identity refused');
  if (username === 'seat') {
    const [name, seatRound, role] = options;
    const [seated] =
      await client`select a.id from users u join actors a on a.user_id=u.id where u.username=${name!}`;
    await client`insert into round_participants ${client({
      id: createId(),
      round_id: seatRound!,
      actor_id: seated!.id,
      role: role!,
      slot: 0,
    })}`;
    process.stdout.write('{}');
    process.exit(0);
  }
  const [account] =
    await client`select u.id,a.id as actor from users u join actors a on a.user_id=u.id where u.username=${username}`;
  if (!account) throw new Error('No such account');
  const host = option('host');
  const [hosting] = host
    ? await client`select a.id from users u join actors a on a.user_id=u.id where u.username=${host}`
    : [null];
  const held = options.includes('held');
  const link = option('link');
  const visibility = link ? 'unlisted' : 'public';
  const [format] =
    await client`select id,current_version as version from formats order by id limit 1`;
  const roomId = createId();
  const roundId = createId();
  const [clock] =
    await client`select now() as now, now() - interval '1 hour' as started, now() + interval '1 hour' as ahead`;
  const started = clock.started as Date;
  await client`insert into rooms ${client({
    id: roomId,
    lobby_id: publicLobbyId,
    host_actor_id: hosting?.id ?? account.actor,
    title: 'Audience proof',
    topic: 'A topic',
    visibility,
    format_id: format.id,
    format_version: format.version,
    competition_type: 'casual',
    config: {},
    execution_plan: {},
    rules_snapshot: validRules,
    status: 'assembling',
  })}`;
  await client`insert into rounds ${client({
    id: roundId,
    room_id: roomId,
    visibility,
    ...(hosting ? { created_by_actor_id: hosting.id } : {}),
    ...(link
      ? {
          audience_link_hash: createHash('sha3-256').update(link).digest('hex'),
        }
      : {}),
    room_config_snapshot: {},
    resolution: 'An audience proof resolution',
    competition_type: 'casual',
    format_id: format.id,
    format_version: format.version,
    rules_snapshot: validRules,
    status: 'completed',
    outcome: 'affirmative',
    started_at: started,
    completed_at: started,
  })}`;
  await client`insert into broadcasts ${client({
    id: createId(),
    round_id: roundId,
    feed_key: createId(),
    release_policy: { kind: 'delay', seconds: 60 },
    released_through_at: held ? null : (clock.ahead as Date),
  })}`;
  await client`insert into notifications ${client({
    id: createId(),
    user_id: account.id,
    kind: 'followed_debater_live',
    round_id: roundId,
    actor_id: account.actor,
  })}`;
  await client`insert into watch_history ${client({
    user_id: account.id,
    round_id: roundId,
    watched_at: clock.now as Date,
  })}`;
  process.stdout.write(JSON.stringify({ roundId }));
} finally {
  await client.close();
}
