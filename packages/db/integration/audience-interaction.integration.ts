import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { audienceReactionOperations } from '../src/audience-reactions';
import { audienceSnapshotReads } from '../src/audience-snapshot-reads';
import { debaterFollowOperations } from '../src/debater-follows';
import { readMessagingChannelFact } from '../src/messaging/social';
import {
  spectatorChatModeration,
  spectatorChatOperations,
  type SpectatorPostPlanner,
} from '../src/messaging/spectator-chat';
import { notificationOperations } from '../src/notifications';
import { watchHistoryOperations } from '../src/watch-history';
import { validConfig, validRules } from './round-fixtures';
import { withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const T0 = '2026-11-02T12:00:00.000Z';
const at = (seconds: number) =>
  new Date(Date.parse(T0) + seconds * 1000).toISOString();
const clockAt = (seconds: number) => ({
  now: at(seconds),
  rankedDelaySeconds: 60,
});

type Env = {
  readonly f: Fixture;
  readonly client: SQL;
  readonly chat: ReturnType<typeof spectatorChatOperations>;
  readonly snapshot: ReturnType<typeof audienceSnapshotReads>;
  readonly reactions: ReturnType<typeof audienceReactionOperations>;
  readonly follows: ReturnType<typeof debaterFollowOperations>;
  readonly history: ReturnType<typeof watchHistoryOperations>;
  readonly notifications: ReturnType<typeof notificationOperations>;
  readonly db: ReturnType<typeof drizzle>;
  readonly audienceRound: (
    visibility?: 'public' | 'unlisted' | 'private',
    overrides?: Record<string, unknown>,
  ) => Promise<string>;
};

const withEnv = async (run: (env: Env) => Promise<void>) => {
  const client = new SQL(databaseUrl, { max: 4 });
  const rounds: string[] = [];
  try {
    await withFixture(databaseUrl, async (f) => {
      const db = drizzle({ client });
      const audienceRound: Env['audienceRound'] = async (
        visibility = 'public',
        overrides = {},
      ) => {
        const format = await f.format();
        const room = await f.room(await f.actor(), format, { visibility });
        const id = await f.round({
          room_id: room,
          room_config_snapshot: validConfig,
          visibility,
          format_id: format,
          rules_snapshot: validRules,
          ...overrides,
        });
        rounds.push(id);
        return id;
      };
      try {
        await run({
          f,
          client,
          db,
          audienceRound,
          chat: spectatorChatOperations({ database: db }),
          snapshot: audienceSnapshotReads({ database: db }),
          reactions: audienceReactionOperations({ database: db }),
          follows: debaterFollowOperations({ database: db }),
          history: watchHistoryOperations({ database: db }),
          notifications: notificationOperations({ database: db }),
        });
      } finally {
        for (const id of rounds) {
          await client`delete from messaging_channels where round_id=${id}`;
          await client`delete from notifications where round_id=${id}`;
          await client`delete from notification_fanouts where round_id=${id}`;
          await client`delete from audience_reactions where round_id=${id}`;
          await client`delete from watch_history where round_id=${id}`;
          await client`delete from recordings where round_id=${id}`;
          await client`delete from broadcasts where round_id=${id}`;
        }
      }
    });
  } finally {
    await client.close();
  }
};

const broadcast = async (
  client: SQL,
  roundId: string,
  columns: {
    readonly released?: string;
    readonly completed?: string;
    readonly stopped?: string;
    readonly slowMode?: number;
  } = {},
) => {
  await client`insert into broadcasts (id,round_id,release_policy,released_through_at,completed_at,stopped_at,stop_reason,chat_slow_mode_seconds)
    values (${createId()},${roundId},${{ kind: 'delay', seconds: 60 }},${columns.released ?? null},${columns.completed ?? null},${columns.stopped ?? null},${columns.stopped ? 'test' : null},${columns.slowMode ?? 0})`;
};

const planner =
  (
    id: string,
    now: string,
    actorId: string,
    text: string,
  ): SpectatorPostPlanner =>
  (_facts, state) =>
    state.receipt && state.existingMessage
      ? { kind: 'replay', message: state.existingMessage }
      : {
          kind: 'create',
          message: {
            id,
            channelId: state.counters.channelId,
            authorActorId: actorId,
            sequence: state.counters.messageSequence + 1,
            changeVersion: state.counters.changeVersion + 1,
            text,
            createdAt: now,
            editedAt: null,
            removedAt: null,
          },
          receipt: { payloadDigest: 'a'.repeat(64), messageId: id },
        };

const post = async (
  env: Env,
  input: {
    readonly roundId: string;
    readonly actorId: string;
    readonly userId: string;
    readonly text: string;
    readonly seconds: number;
    readonly requestId?: string;
  },
) =>
  env.chat.postSpectatorChatMessage(
    {
      roundId: input.roundId,
      actorId: input.actorId,
      userId: input.userId,
      newChannelId: createId(),
      command: {
        version: 1,
        requestId: input.requestId ?? createId(),
        text: input.text,
      },
    },
    planner(createId(), at(input.seconds), input.actorId, input.text),
  );

const member = async (f: Fixture) => {
  const userId = await f.user();
  return { userId, actorId: await f.actor(userId) };
};

test('chat reaches no one before the timeline passes it, and only the audience read holds it', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound();
    await broadcast(env.client, roundId);
    const poster = await member(env.f);
    const message = await post(env, {
      roundId,
      ...poster,
      text: 'A released line',
      seconds: 0,
    });
    const held = await env.chat.readSpectatorChat({
      roundId,
      clock: clockAt(5),
      limit: 10,
    });
    await env.client`update broadcasts set released_through_at=${at(120)} where round_id=${roundId}`;
    const released = await env.chat.readSpectatorChat({
      roundId,
      clock: clockAt(121),
      limit: 10,
    });
    const [channel] =
      (await env.client`select id,kind,policy_key from messaging_channels where round_id=${roundId}`) as {
        id: string;
        kind: string;
        policy_key: string;
      }[];
    const socialFact = await env.db.transaction((tx) =>
      readMessagingChannelFact(tx, channel!.id, poster.actorId),
    );
    assert({
      given: 'a message the watermark has not reached, then one it has',
      should:
        'return nothing, then the message, on a spectator channel no DM or group read can see',
      actual: {
        held,
        released: released.map((row) => [row.id, row.author, row.text]),
        kind: [channel!.kind, channel!.policy_key],
        socialFact,
      },
      expected: {
        held: [],
        released: [[message!.id, `u-${poster.userId}`, 'A released line']],
        kind: ['round_spectator', 'round.spectator'],
        socialFact: null,
      },
    });
  });
});

test('a retried post keeps one message, and a Round with no audience has no chat', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound();
    await broadcast(env.client, roundId);
    const privateRound = await env.audienceRound('private');
    await broadcast(env.client, privateRound);
    const poster = await member(env.f);
    const requestId = createId();
    const first = await post(env, {
      roundId,
      ...poster,
      text: 'Once',
      seconds: 0,
      requestId,
    });
    const second = await post(env, {
      roundId,
      ...poster,
      text: 'Once',
      seconds: 1,
      requestId,
    });
    const hidden = await post(env, {
      roundId: privateRound,
      ...poster,
      text: 'Nobody reads this',
      seconds: 0,
    });
    const [count] =
      (await env.client`select count(*)::int as c from messaging_messages m join messaging_channels c on c.id=m.channel_id where c.round_id=${roundId}`) as {
        c: number;
      }[];
    assert({
      given: 'the same request id twice, and a post to a private Round',
      should: 'keep one message, and treat the private Round as missing',
      actual: { same: first!.id === second!.id, count: count!.c, hidden },
      expected: { same: true, count: 1, hidden: null },
    });
  });
});

test('the planner sees the ban, slow mode, last post and closed Broadcast in the transaction', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound();
    await broadcast(env.client, roundId, { slowMode: 30 });
    const poster = await member(env.f);
    await post(env, { roundId, ...poster, text: 'First', seconds: 0 });
    await env.client`insert into audience_bans (user_id,banned_by_ref) values (${poster.userId},'operator')`;
    await env.client`update broadcasts set stopped_at=${at(1)},stop_reason='test' where round_id=${roundId}`;
    let seen: unknown;
    await env.chat.postSpectatorChatMessage(
      {
        roundId,
        ...poster,
        newChannelId: createId(),
        command: { version: 1, requestId: createId(), text: 'Second' },
      },
      (facts, state) => {
        seen = facts;
        return planner(
          createId(),
          at(2),
          poster.actorId,
          'Second',
        )(facts, state);
      },
    );
    await env.client`delete from audience_bans where user_id=${poster.userId}`;
    assert({
      given: 'a banned poster on a stopped Broadcast with slow mode on',
      should: 'hand the decision every fact, read fresh',
      actual: seen,
      expected: {
        broadcast: { open: false, slowModeSeconds: 30 },
        account: { erased: false, restricted: false, underThirteen: false },
        banned: true,
        lastPostAtMs: Date.parse(at(0)),
      },
    });
  });
});

test('moderation removes a spectator message for everyone and reaches no other channel', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound();
    await broadcast(env.client, roundId, { released: at(120) });
    const poster = await member(env.f);
    const reporter = await member(env.f);
    const message = await post(env, {
      roundId,
      ...poster,
      text: 'Abusive line',
      seconds: 0,
    });
    const facts = await spectatorChatModeration.readReportFacts(env.db, {
      messageId: message!.id,
      reporterActorId: reporter.actorId,
    });
    const own = await spectatorChatModeration.readReportFacts(env.db, {
      messageId: message!.id,
      reporterActorId: poster.actorId,
    });
    const subject = await spectatorChatModeration.readSubject(
      env.db,
      message!.id,
    );
    const removed = await spectatorChatModeration.remove(env.db, {
      messageId: message!.id,
      now: new Date(at(30)),
    });
    const again = await spectatorChatModeration.remove(env.db, {
      messageId: message!.id,
      now: new Date(at(31)),
    });
    const missing = await spectatorChatModeration.remove(env.db, {
      messageId: createId(),
      now: new Date(at(31)),
    });
    const [read] = await env.chat.readSpectatorChat({
      roundId,
      clock: clockAt(121),
      limit: 10,
    });
    assert({
      given: 'a reported spectator message',
      should:
        'tell a reporter from its author, then remove it once and keep its place with nothing of it left',
      actual: {
        facts,
        own,
        subject,
        results: [removed, again, missing],
        read: { author: read!.author, text: read!.text },
      },
      expected: {
        facts: { ownMessage: false },
        own: { ownMessage: true },
        subject: { text: 'Abusive line', authorUserId: poster.userId },
        results: ['applied', 'unchanged', null],
        read: { author: null, text: null },
      },
    });
  });
});

test('reaction totals follow the timeline, and one window holds one press', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound();
    await broadcast(env.client, roundId);
    const account = await member(env.f);
    const press = (seconds: number, spacedAt: number) =>
      env.reactions.recordAudienceReaction(
        {
          id: createId(),
          roundId,
          userId: account.userId,
          kind: 'sharp_point',
          at: at(seconds),
          spacedAt: at(spacedAt),
        },
        () => {},
      );
    await press(0, 0);
    await press(1, 0);
    await press(11, 10);
    const totals = async (seconds: number) =>
      (await env.snapshot.readAudienceSnapshot({
        roundId,
        clock: clockAt(seconds),
      }))!.reactions;
    const before = await totals(5);
    await env.client`update broadcasts set released_through_at=${at(120)} where round_id=${roundId}`;
    assert({
      given: 'three presses in two windows, held and then released',
      should: 'show nothing, then a total of two',
      actual: { before, after: await totals(121) },
      expected: {
        before: [],
        after: [{ kind: 'sharp_point', count: 2 }],
      },
    });
  });
});

test('following: one way, refused for yourself, a stranger or a block with one answer', async () => {
  await withEnv(async (env) => {
    const fan = await member(env.f);
    const debater = await member(env.f);
    const blocker = await member(env.f);
    const set = (username: string, state: 'following' | 'not_following') =>
      env.follows.setDebaterFollow({
        followerUserId: fan.userId,
        username,
        state,
      });
    const [low, high] = [fan.actorId, blocker.actorId].sort();
    await env.client`insert into contact_pairs (low_actor_id,high_actor_id,high_blocks_low,low_blocks_high)
      values (${low!},${high!},true,false)`;
    const results = [
      await set(`U-${debater.userId}`, 'following'),
      await set(`u-${debater.userId}`, 'following'),
      await set(`u-${fan.userId}`, 'following'),
      await set('no-such-name', 'following'),
      await set(`u-${blocker.userId}`, 'following'),
    ];
    const listed = await env.follows.listFollowedDebaters({
      followerUserId: fan.userId,
      limit: 10,
    });
    const read = await env.follows.readDebaterFollow({
      followerUserId: fan.userId,
      username: `u-${debater.userId}`,
    });
    const after = await set(`u-${debater.userId}`, 'not_following');
    const none = await env.follows.listFollowedDebaters({
      followerUserId: fan.userId,
      limit: 10,
    });
    await env.client`delete from contact_pairs where low_actor_id=${low!} and high_actor_id=${high!}`;
    assert({
      given: 'a follow, its repeat, and refused follows',
      should: 'keep one row, answer every refusal alike, and let go on request',
      actual: { results, listed, read, after, none },
      expected: {
        results: [
          'following',
          'following',
          'unavailable',
          'unavailable',
          'unavailable',
        ],
        listed: [`u-${debater.userId}`],
        read: { following: true },
        after: 'not_following',
        none: [],
      },
    });
  });
});

test('watch history holds an unreleased resolution back and forgets on request', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound('public', {
      status: 'completed',
      current_stage: null,
      outcome: 'affirmative',
      started_at: at(0),
      completed_at: at(1),
      resolution: 'A resolution not yet out',
    });
    await broadcast(env.client, roundId);
    const privateRound = await env.audienceRound('private');
    const viewer = await member(env.f);
    await env.history.recordWatched({
      userId: viewer.userId,
      roundId,
      at: at(5),
    });
    await env.history.recordWatched({
      userId: viewer.userId,
      roundId,
      at: at(1),
    });
    await env.history.recordWatched({
      userId: viewer.userId,
      roundId: privateRound,
      at: at(5),
    });
    const list = (seconds: number) =>
      env.history.listWatchHistory({
        userId: viewer.userId,
        clock: clockAt(seconds),
        limit: 10,
      });
    const held = await list(10);
    await env.client`update broadcasts set released_through_at=${at(120)} where round_id=${roundId}`;
    const released = await list(121);
    await env.history.forgetWatched({ userId: viewer.userId, roundId });
    assert({
      given: 'visits to a held Round and a private one',
      should:
        'keep the newest visit, hide the resolution until release, skip the private Round, then forget',
      actual: {
        held: held.map((row) => [row.roundId, row.resolution, row.watchedAt]),
        released: released.map((row) => row.resolution),
        gone: await list(121),
      },
      expected: {
        held: [[roundId, null, at(5)]],
        released: ['A resolution not yet out'],
        gone: [],
      },
    });
  });
});

const sweep = (env: Env, seconds: number) =>
  env.notifications.sweepNotificationFanouts({
    clock: clockAt(seconds),
    limit: 50,
    nextId: createId,
  });

const rowsFor = async (env: Env, userId: string) =>
  (
    await env.notifications.readNotifications({
      userId,
      unreadOnly: false,
      limit: 10,
    })
  ).rows.map((row) => row.kind);

test('a follower hears nothing before release, once after it, and only of a public Round', async () => {
  await withEnv(async (env) => {
    const fan = await member(env.f);
    const offFan = await member(env.f);
    const debater = await member(env.f);
    const follow = (followerUserId: string) =>
      env.follows.setDebaterFollow({
        followerUserId,
        username: `u-${debater.userId}`,
        state: 'following',
      });
    await follow(fan.userId);
    await follow(offFan.userId);
    await env.notifications.writeNotificationPreferences({
      userId: offFan.userId,
      preferences: { followed_debater_live: false, recording_ready: true },
    });
    const roundId = await env.audienceRound();
    await env.f.participant(roundId, 'affirmative', 0, debater.actorId);
    await broadcast(env.client, roundId);
    const unlisted = await env.audienceRound('unlisted');
    await env.f.participant(unlisted, 'affirmative', 0, debater.actorId);
    await broadcast(env.client, unlisted, { released: at(1) });
    await sweep(env, 5);
    const early = await rowsFor(env, fan.userId);
    await env.client`update broadcasts set released_through_at=${at(10)} where round_id=${roundId}`;
    await sweep(env, 11);
    await sweep(env, 12);
    const row = (
      await env.notifications.readNotifications({
        userId: fan.userId,
        unreadOnly: false,
        limit: 10,
      })
    ).rows;
    const columns =
      (await env.client`select column_name from information_schema.columns
      where table_name='notifications' order by column_name`) as {
        column_name: string;
      }[];
    assert({
      given: 'a follower, one who turned this off, and an unlisted Round',
      should:
        'write nothing before the first release, one row after it, none for the other two; and no column can hold an outcome',
      actual: {
        early,
        fan: row.map((item) => [item.kind, item.roundId, item.debater]),
        off: await rowsFor(env, offFan.userId),
        columns: columns.map((column) => column.column_name),
      },
      expected: {
        early: [],
        fan: [['followed_debater_live', roundId, `u-${debater.userId}`]],
        off: [],
        columns: [
          'created_at',
          'debater_actor_id',
          'id',
          'kind',
          'read_at',
          'round_id',
          'user_id',
        ],
      },
    });
  });
});

test('recording_ready waits for a complete Broadcast, and a takedown takes the notification', async () => {
  await withEnv(async (env) => {
    const debater = await member(env.f);
    const fan = await member(env.f);
    await env.follows.setDebaterFollow({
      followerUserId: fan.userId,
      username: `u-${debater.userId}`,
      state: 'following',
    });
    const roundId = await env.audienceRound('public');
    await env.f.participant(roundId, 'affirmative', 0, debater.actorId);
    await broadcast(env.client, roundId, { released: at(1) });
    await env.client`insert into recordings (id,round_id,recording_class,eligibility,status,lifecycle)
      values (${createId()},${roundId},'casual',${{ kind: 'casual_opted_in', hostActorId: debater.actorId }},'ready',${{ status: 'ready' }})`;
    await sweep(env, 5);
    const waiting = await rowsFor(env, debater.userId);
    await env.client`update broadcasts set completed_at=${at(6)},released_through_at=${at(6)} where round_id=${roundId}`;
    await sweep(env, 120);
    const seated = await rowsFor(env, debater.userId);
    const follower = await rowsFor(env, fan.userId);
    await env.client`update recordings set status='taken_down',lifecycle=${{ status: 'taken_down' }} where round_id=${roundId}`;
    assert({
      given:
        'a ready Recording while its Broadcast runs, then once it is complete',
      should:
        'tell no one, then the seat and the follower, and hide it again on a takedown',
      actual: {
        waiting,
        seated,
        follower: follower.includes('recording_ready'),
        afterTakedown: await rowsFor(env, debater.userId),
      },
      expected: {
        waiting: [],
        seated: ['recording_ready'],
        follower: true,
        afterTakedown: [],
      },
    });
  });
});

test('reading is per account, and a read notification leaves 90 days later', async () => {
  await withEnv(async (env) => {
    const fan = await member(env.f);
    const other = await member(env.f);
    const debater = await member(env.f);
    await env.follows.setDebaterFollow({
      followerUserId: fan.userId,
      username: `u-${debater.userId}`,
      state: 'following',
    });
    const roundId = await env.audienceRound();
    await env.f.participant(roundId, 'affirmative', 0, debater.actorId);
    await broadcast(env.client, roundId, { released: at(1) });
    await sweep(env, 5);
    const read = () =>
      env.notifications.readNotifications({
        userId: fan.userId,
        unreadOnly: true,
        limit: 10,
      });
    const unread = await read();
    await env.notifications.markNotificationsRead({
      userId: other.userId,
      notificationId: unread.rows[0]!.id,
      at: at(6),
    });
    const stillUnread = (await read()).unread;
    await env.notifications.markNotificationsRead({
      userId: fan.userId,
      notificationId: unread.rows[0]!.id,
      at: at(6),
    });
    const afterRead = (await read()).unread;
    await env.notifications.purgeReadNotifications({
      before: at(0),
      limit: 10,
    });
    const kept = await rowsFor(env, fan.userId);
    const purged = await env.notifications.purgeReadNotifications({
      before: at(7),
      limit: 10,
    });
    assert({
      given:
        'another account marking it, then its owner, then two retention passes',
      should: 'change nothing, then mark it, keep it, then delete it',
      actual: {
        before: unread.unread,
        stillUnread,
        afterRead,
        kept,
        purged,
        gone: await rowsFor(env, fan.userId),
      },
      expected: {
        before: 1,
        stillUnread: 1,
        afterRead: 0,
        kept: ['followed_debater_live'],
        purged: 1,
        gone: [],
      },
    });
  });
});

test('stored preferences read back as saved', async () => {
  await withEnv(async (env) => {
    const account = await member(env.f);
    const first = await env.notifications.readNotificationPreferences({
      userId: account.userId,
    });
    await env.notifications.writeNotificationPreferences({
      userId: account.userId,
      preferences: { followed_debater_live: false, recording_ready: true },
    });
    assert({
      given: 'no stored choice, then a saved one (ISSUE-1045)',
      should: 'read on by default, then exactly what was stored',
      actual: {
        first,
        stored: await env.notifications.readNotificationPreferences({
          userId: account.userId,
        }),
      },
      expected: {
        first: { followed_debater_live: true, recording_ready: true },
        stored: { followed_debater_live: false, recording_ready: true },
      },
    });
  });
});

test('a seat reads as what its Round is, and no seat reads as none', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound('public', {
      competition_type: 'ranked',
      format_id: 'freestyle',
      preset_version: 1,
      ladder_id: 'freestyle',
      status: 'completed',
      outcome: 'affirmative',
      started_at: at(0),
      completed_at: at(1),
    });
    const debater = await member(env.f);
    await env.f.participant(roundId, 'affirmative', 0, debater.actorId);
    await env.client`insert into broadcasts (id,round_id,release_policy,debaters_read_chat)
      values (${createId()},${roundId},${{ kind: 'delay', seconds: 60 }},true)`;
    assert({
      given: 'a ranked seat whose Broadcast wrongly says debaters may read',
      should:
        'report the facts for the feature’s rule, and nothing for a stranger',
      actual: [
        await env.snapshot.readAudienceSeat({
          roundId,
          actorId: debater.actorId,
        }),
        await env.snapshot.readAudienceSeat({ roundId, actorId: createId() }),
      ],
      expected: [
        {
          role: 'affirmative',
          competitionType: 'ranked',
          roundEnded: true,
          debatersReadChat: true,
        },
        null,
      ],
    });
  });
});
