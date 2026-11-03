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
import { openDm } from './messaging-retained-dm.test-support';
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
  await client`insert into broadcasts (id,round_id,feed_key,release_policy,released_through_at,completed_at,stopped_at,stop_reason,chat_slow_mode_seconds)
    values (${createId()},${roundId},${createId()},${{ kind: 'delay', seconds: 60 }},${columns.released ?? null},${columns.completed ?? null},${columns.stopped ?? null},${columns.stopped ? 'test' : null},${columns.slowMode ?? 0})`;
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
      admit: () => true,
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

test('chat reaches a reader at once, with the feed still held, and only the audience read holds it', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound();
    // No watermark at all: the release timeline has not started.
    await broadcast(env.client, roundId);
    const poster = await member(env.f);
    const message = await post(env, {
      roundId,
      ...poster,
      text: 'A line',
      seconds: 0,
    });
    const read = await env.chat.readSpectatorChat({ roundId, limit: 10 });
    const snapshot = await env.snapshot.readAudienceSnapshot({ roundId });
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
      given: 'a message on a Broadcast the timeline has not reached',
      should:
        'return it at once, on a spectator channel no DM or group read can see',
      actual: {
        read: read.map((row) => [row.id, row.author, row.text]),
        inSnapshot: snapshot?.messages.map((row) => row.text),
        visibility: snapshot?.visibility,
        kind: [channel!.kind, channel!.policy_key],
        socialFact,
      },
      expected: {
        read: [[message!.id, `u-${poster.userId}`, 'A line']],
        inSnapshot: ['A line'],
        visibility: 'public',
        kind: ['round_spectator', 'round.spectator'],
        socialFact: null,
      },
    });
  });
});

test('the live room is told apart in the post transaction: a seat of any role and a seatless host', async () => {
  await withEnv(async (env) => {
    const debater = await member(env.f);
    const judge = await member(env.f);
    const host = await member(env.f);
    const viewer = await member(env.f);
    const roundId = await env.audienceRound('public', {
      created_by_actor_id: host.actorId,
    });
    await broadcast(env.client, roundId);
    await env.f.participant(roundId, 'affirmative', 0, debater.actorId);
    await env.f.participant(roundId, 'judge', 0, judge.actorId);
    const seenBy = async (account: typeof viewer) => {
      let seen: { inLiveRoom: boolean } | undefined;
      await env.chat.postSpectatorChatMessage(
        {
          roundId,
          ...account,
          newChannelId: createId(),
          admit: () => true,
          command: { version: 1, requestId: createId(), text: 'A line' },
        },
        (facts, state) => {
          seen = facts;
          return planner(
            createId(),
            at(0),
            account.actorId,
            'A line',
          )(facts, state);
        },
      );
      return seen?.inLiveRoom;
    };
    const standing = (actorId: string) =>
      env.snapshot.readLiveRoomStanding({ roundId, actorId });
    assert({
      given: 'a debater, a judge, a seatless host and a viewer',
      should:
        'put the first three in the live room, for the planner and for the read alike',
      actual: {
        planner: [
          await seenBy(debater),
          await seenBy(judge),
          await seenBy(host),
          await seenBy(viewer),
        ],
        standing: [
          (await standing(debater.actorId))?.kind,
          (await standing(judge.actorId))?.kind,
          (await standing(host.actorId))?.kind,
          await standing(viewer.actorId),
        ],
      },
      expected: {
        planner: [true, true, true, false],
        standing: ['seat', 'seat', 'seatless-host', null],
      },
    });
  });
});

test('a post or a press the audience does not admit writes nothing, not even a channel', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound('unlisted', {
      audience_link_hash: 'current',
    });
    await broadcast(env.client, roundId);
    const account = await member(env.f);
    const offered: unknown[] = [];
    const refuse = (admission: unknown) => {
      offered.push(admission);
      return false;
    };
    const posted = await env.chat.postSpectatorChatMessage(
      {
        roundId,
        ...account,
        newChannelId: createId(),
        admit: refuse,
        command: { version: 1, requestId: createId(), text: 'A line' },
      },
      planner(createId(), at(0), account.actorId, 'A line'),
    );
    const pressed = await env.reactions.recordAudienceReaction(
      {
        id: createId(),
        roundId,
        ...account,
        admit: refuse,
        kind: 'sharp_point',
        at: at(0),
        spacedAt: at(0),
      },
      () => {},
    );
    const [channels] =
      (await env.client`select count(*)::int as c from messaging_channels where round_id=${roundId}`) as {
        c: number;
      }[];
    const [presses] =
      (await env.client`select count(*)::int as c from audience_reactions where round_id=${roundId}`) as {
        c: number;
      }[];
    const admission = {
      visibility: 'unlisted',
      audienceLinkHash: 'current',
      inLiveRoom: false,
    };
    assert({
      given: 'an unlisted Round refusing this request',
      should: 'answer null and store nothing, offering the rule its link facts',
      actual: {
        posted,
        pressed,
        channels: channels!.c,
        presses: presses!.c,
        offered,
      },
      expected: {
        posted: null,
        pressed: null,
        channels: 0,
        presses: 0,
        offered: [admission, admission],
      },
    });
  });
});

test('the retention sweep takes spectator chat and reactions at 180 days, and no DM or group', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound();
    await broadcast(env.client, roundId);
    const poster = await member(env.f);
    const day0 = at(0);
    const old = await post(env, {
      roundId,
      ...poster,
      text: 'Old',
      seconds: 0,
    });
    const young = await post(env, {
      roundId,
      ...poster,
      text: 'Young',
      seconds: 100 * 86_400,
    });
    const privateChannel = createId();
    const privateMessage = createId();
    await env.client`insert into messaging_channels (id,kind,policy_key,policy_revision,lifecycle)
      values (${privateChannel},'dm','social.dm',1,'active')`;
    await env.client`insert into messaging_messages (id,channel_id,author_actor_id,sequence,change_version,text,created_at)
      values (${privateMessage},${privateChannel},${poster.actorId},1,1,'Private',${day0})`;
    const press = (seconds: number) =>
      env.reactions.recordAudienceReaction(
        {
          id: createId(),
          roundId,
          ...poster,
          admit: () => true,
          kind: 'sharp_point',
          at: at(seconds),
          spacedAt: at(seconds),
        },
        () => {},
      );
    await press(0);
    await press(100 * 86_400);
    const before = at(20 * 86_400);
    const [chatGone, chatAgain, pressesGone, pressesAgain] = [
      await env.chat.purgeExpiredSpectatorChat({ before, limit: 10 }),
      await env.chat.purgeExpiredSpectatorChat({ before, limit: 10 }),
      await env.reactions.purgeExpiredAudienceReactions({ before, limit: 10 }),
      await env.reactions.purgeExpiredAudienceReactions({ before, limit: 10 }),
    ];
    const left = await env.chat.readSpectatorChat({ roundId, limit: 10 });
    const receipts =
      (await env.client`select message_id from messaging_receipts where message_id=${old!.id}`) as unknown[];
    const privateLeft =
      (await env.client`select id from messaging_messages where id=${privateMessage}`) as unknown[];
    const snapshot = await env.snapshot.readAudienceSnapshot({ roundId });
    const next = await post(env, {
      roundId,
      ...poster,
      text: 'Next',
      seconds: 201 * 86_400,
    });
    await env.client`delete from messaging_messages where id=${privateMessage}`;
    await env.client`delete from messaging_channels where id=${privateChannel}`;
    assert({
      given: 'rows either side of the cutoff, and an older private message',
      should:
        'delete the old message with its receipt and the old press, once, keep the young ones and the private message, and leave the stream able to post',
      actual: {
        gone: [chatGone, chatAgain, pressesGone, pressesAgain],
        left: left.map((row) => row.id),
        receipts: receipts.length,
        privateLeft: privateLeft.length,
        totals: snapshot?.reactions,
        nextSequence: next?.sequence,
      },
      expected: {
        gone: [1, 0, 1, 0],
        left: [young!.id],
        receipts: 0,
        privateLeft: 1,
        totals: [{ kind: 'sharp_point', count: 1 }],
        nextSequence: young!.sequence + 1,
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

test('chat keeps its history when a Broadcast fails or stops', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound();
    await broadcast(env.client, roundId);
    const poster = await member(env.f);
    await post(env, { roundId, ...poster, text: 'Before', seconds: 0 });
    const texts = async () => ({
      chat: (await env.chat.readSpectatorChat({ roundId, limit: 10 })).map(
        (row) => row.text,
      ),
      snapshot: (
        await env.snapshot.readAudienceSnapshot({ roundId })
      )?.messages.map((row) => row.text),
    });
    const live = await texts();
    // Failed: the Broadcast closed having released nothing (`standingOf`).
    await env.client`update broadcasts set completed_at=${at(5)}, released_through_at=null where round_id=${roundId}`;
    const failed = await texts();
    await env.client`update broadcasts set stopped_at=${at(7)}, stop_reason='test' where round_id=${roundId}`;
    assert({
      given: 'chat read live, after a failed Broadcast, and after a stop',
      should: 'read the same history each time, in both reads',
      actual: { failed, stopped: await texts() },
      expected: { failed: live, stopped: live },
    });
  });
});

test('a seat taken and given up changes nothing about a DM between the two debaters', async () => {
  await withEnv(async (env) => {
    const dm = await openDm(databaseUrl);
    const { channelId, subject, survivor } = dm;
    const roundId = await env.audienceRound();
    try {
      await broadcast(env.client, roundId);
      const facts = async () => [
        await readMessagingChannelFact(dm.database, channelId, subject.actorId),
        await readMessagingChannelFact(
          dm.database,
          channelId,
          survivor.actorId,
        ),
      ];
      const messages = async () =>
        (await dm.client.unsafe(
          'select id from messaging_messages where channel_id=$1 order by sequence',
          [channelId],
        )) as unknown[];
      const spectators = await facts();
      const history = await messages();
      await post(env, {
        roundId,
        ...subject,
        text: 'From the crowd',
        seconds: 0,
      });
      const spectating = await facts();
      await env.f.participant(roundId, 'affirmative', 0, subject.actorId);
      await env.f.participant(roundId, 'negative', 0, survivor.actorId);
      const seated = await facts();
      await env.client`delete from round_participants where round_id=${roundId}`;
      const unseated = await facts();
      assert({
        given: 'two people with a DM who watch, take seats, then lose them',
        should: 'read that DM and its history the same at every step',
        actual: {
          exists: spectators.every((fact) => fact !== null),
          spectating,
          seated,
          unseated,
          history: await messages(),
        },
        expected: {
          exists: true,
          spectating: spectators,
          seated: spectators,
          unseated: spectators,
          history,
        },
      });
    } finally {
      // Its author goes with the DM fixture, so the crowd's line goes first.
      await env.client`delete from messaging_channels where round_id=${roundId}`;
      await dm.close();
    }
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
        admit: () => true,
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
        inLiveRoom: false,
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
        facts: {
          ownMessage: false,
          audience: {
            roundId,
            visibility: 'public',
            audienceLinkHash: null,
            inLiveRoom: false,
          },
        },
        own: {
          ownMessage: true,
          audience: {
            roundId,
            visibility: 'public',
            audienceLinkHash: null,
            inLiveRoom: false,
          },
        },
        subject: { text: 'Abusive line', authorUserId: poster.userId },
        results: ['applied', 'unchanged', null],
        read: { author: null, text: null },
      },
    });
  });
});

test('reaction totals are current, and one window holds one press', async () => {
  await withEnv(async (env) => {
    const roundId = await env.audienceRound();
    await broadcast(env.client, roundId);
    const account = await member(env.f);
    const press = (seconds: number, spacedAt: number) =>
      env.reactions.recordAudienceReaction(
        {
          id: createId(),
          roundId,
          ...account,
          admit: () => true,
          kind: 'sharp_point',
          at: at(seconds),
          spacedAt: at(spacedAt),
        },
        () => {},
      );
    await press(0, 0);
    await press(1, 0);
    await press(11, 10);
    assert({
      given: 'three presses in two windows, with the timeline not started',
      should: 'show a total of two at once',
      actual: (await env.snapshot.readAudienceSnapshot({ roundId }))!.reactions,
      expected: [{ kind: 'sharp_point', count: 2 }],
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

test('a block after a follow takes that debater off the list, and lifting it restores them', async () => {
  await withEnv(async (env) => {
    const fan = await member(env.f);
    const debater = await member(env.f);
    const listed = () =>
      env.follows.listFollowedDebaters({
        followerUserId: fan.userId,
        limit: 10,
      });
    await env.follows.setDebaterFollow({
      followerUserId: fan.userId,
      username: `u-${debater.userId}`,
      state: 'following',
    });
    const before = await listed();
    const [low, high] = [fan.actorId, debater.actorId].sort();
    await env.client`insert into contact_pairs (low_actor_id,high_actor_id,high_blocks_low,low_blocks_high)
      values (${low!},${high!},true,false)`;
    const blocked = await listed();
    await env.client`delete from contact_pairs where low_actor_id=${low!} and high_actor_id=${high!}`;
    assert({
      given: 'a debater followed, then a block between the two, then none',
      should: 'list them, not list them, then list them again',
      actual: [before, blocked, await listed()],
      expected: [[`u-${debater.userId}`], [], [`u-${debater.userId}`]],
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
    await env.client`insert into broadcasts (id,round_id,feed_key,release_policy,debaters_read_chat)
      values (${createId()},${roundId},${createId()},${{ kind: 'delay', seconds: 60 }},true)`;
    assert({
      given: 'a ranked seat whose Broadcast wrongly says debaters may read',
      should:
        'report the facts for the feature’s rule, and nothing for a stranger',
      actual: [
        await env.snapshot.readLiveRoomStanding({
          roundId,
          actorId: debater.actorId,
        }),
        await env.snapshot.readLiveRoomStanding({
          roundId,
          actorId: createId(),
        }),
      ],
      expected: [
        {
          kind: 'seat',
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
