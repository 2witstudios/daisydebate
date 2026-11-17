import { createHash } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { validRules, publicLobbyId } from '@daisy/db/testing';
import { SQL } from 'bun';
import { affirmativeSide, emptyRuntimeCheckpointFor } from '@daisy/protocol';
import { betaAccessTarget } from './beta-access-target';

/**
 * A Round on air, plus one stored notification and one watched Round for the
 * account named. Its Broadcast's watermark is ahead of now, so its resolution is
 * out, unless `held`: then nothing has been released, and what the spec reads of
 * the audience proves the audience is not on that timeline. Same isolated e2e
 * boundary as beta approval.
 *
 * `seat <username> <roundId>` puts an account in an existing `judged` Round's
 * live room as its replacement judge, then ends that Round; `host` names who hosts it, seatless, and `link` makes
 * it unlisted.
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
    // The cast froze at Start (round_participants_fixed_cast): the one way into
    // a Round's live room after it began is a judge assignment, so the account
    // replaces the Round's judge through its ordinary command.
    const [name, seatRound] = options;
    const [seated] =
      await client`select a.id from users u join actors a on a.user_id=u.id where u.username=${name!}`;
    await client.begin(async (tx) => {
      const [round] =
        await tx`select version from rounds where id=${seatRound!} for no key update`;
      const [slot] =
        await tx`select current_version from round_judge_slots where round_id=${seatRound!} and slot=0`;
      const commandId = createId();
      const participantId = createId();
      const [{ now: appliedAt }] = await tx`select clock_timestamp() as now`;
      await tx`insert into round_commands ${tx({
        command_id: commandId,
        round_id: seatRound!,
        actor_id: seated!.id,
        type: 'change_judge',
        payload_digest: createHash('sha3-256').update(commandId).digest('hex'),
        result: {
          kind: 'judge_assignment',
          roundId: seatRound!,
          slot: 0,
          assignmentVersion: slot!.current_version + 1,
          participantId,
        },
        resulting_version: round!.version + 1,
        applied_at: appliedAt,
      })}`;
      await tx`insert into round_participants ${tx({
        id: participantId,
        round_id: seatRound!,
        actor_id: seated!.id,
        seat_kind: 'judge',
        slot: 0,
      })}`;
      await tx`select public.daisy_append_round_judge_assignment(${seatRound!},0,${round!.version},${slot!.current_version},${participantId},${commandId})`;
      // Then the Round ends: afterwards a seat reads chat like anyone, and is
      // still in the live room, so it cannot post.
      await tx`update rounds set ${tx({
        status: 'completed',
        current_stage: null,
        winning_side: affirmativeSide,
        completed_at: appliedAt,
      })} where id=${seatRound!}`;
    });
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
  // One judge slot, filled at construction, that `seat` can later reassign.
  const judged = options.includes('judged');
  const rules = judged
    ? { ...validRules, seats: { ...validRules.seats, judges: 1 } }
    : validRules;
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
    rules_snapshot: rules,
    status: 'assembling',
  })}`;
  await client.begin(async (tx) => {
    await tx`insert into rounds ${tx({
      id: roundId,
      room_id: roomId,
      visibility,
      ...(hosting ? { created_by_actor_id: hosting.id } : {}),
      ...(link
        ? {
            audience_link_hash: createHash('sha3-256')
              .update(link)
              .digest('hex'),
          }
        : {}),
      room_config_snapshot: {},
      resolution: 'An audience proof resolution',
      competition_type: 'casual',
      format_id: format.id,
      format_version: format.version,
      rules_snapshot: rules,
      runtime_state: emptyRuntimeCheckpointFor(rules),
      status: 'active',
      current_stage: 'live',
      started_at: started,
    })}`;
    // The cast is seated while the Round is constructed. A judged Round stays
    // on air until `seat`, since only an active Round's judge is reassigned.
    for (let slot = 0; slot < rules.seats.judges; slot += 1) {
      const [user] =
        await tx`insert into users (id,username) values (${createId()},${`judge-${createId()}`}) returning id`;
      const [judge] =
        await tx`insert into actors (id,kind,user_id) values (${createId()},'human',${user!.id}) returning id`;
      await tx`insert into round_participants ${tx({
        id: createId(),
        round_id: roundId,
        actor_id: judge!.id,
        seat_kind: 'judge',
        slot,
      })}`;
    }
    if (!judged)
      await tx`update rounds set ${tx({
        status: 'completed',
        current_stage: null,
        winning_side: affirmativeSide,
        completed_at: started,
      })} where id=${roundId}`;
  });
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
