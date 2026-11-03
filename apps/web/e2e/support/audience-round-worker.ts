import { createId } from '@paralleldrive/cuid2';
import { validRules } from '@daisy/db/testing';
import { SQL } from 'bun';
import { betaAccessTarget } from './beta-access-target';

/**
 * A public Round with a Broadcast whose watermark is ahead of now, so what the
 * spec posts is released at once, plus one stored notification and one watched
 * Round for the account named. Same isolated e2e boundary as beta approval.
 */
const [username] = process.argv.slice(2);
if (!username) throw new Error('Name the account');
const client = new SQL(betaAccessTarget(process.env), { max: 1 });
try {
  const [identity] = await client`select current_user as role`;
  if (identity?.role !== 'daisy_e2e') throw new Error('Identity refused');
  const [account] =
    await client`select u.id,a.id as actor from users u join actors a on a.user_id=u.id where u.username=${username}`;
  if (!account) throw new Error('No such account');
  const [format] =
    await client`select id,current_version as version from formats order by id limit 1`;
  const roomId = createId();
  const roundId = createId();
  const started = new Date(Date.now() - 3_600_000);
  await client`insert into rooms ${client({
    id: roomId,
    host_actor_id: account.actor,
    title: 'Audience proof',
    topic: 'A topic',
    visibility: 'public',
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
    visibility: 'public',
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
    release_policy: { kind: 'delay', seconds: 60 },
    released_through_at: new Date(Date.now() + 3_600_000),
  })}`;
  await client`insert into notifications ${client({
    id: createId(),
    user_id: account.id,
    kind: 'followed_debater_live',
    round_id: roundId,
    debater_actor_id: account.actor,
  })}`;
  await client`insert into watch_history ${client({
    user_id: account.id,
    round_id: roundId,
    watched_at: new Date(),
  })}`;
  process.stdout.write(JSON.stringify({ roundId }));
} finally {
  await client.close();
}
