import { requireTestServices } from '@daisy/config';
import { noopErrorReporter } from '@daisy/observability';
import { audienceSnapshotSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAudienceReactionRoute } from '../src/features/audience-reactions/handler';
import { createReportHandler } from '../src/features/content-moderation/report-handler';
import { createSpectatorChatRoute } from '../src/features/messaging/spectator-chat/handler';
import { createDebaterFollowRoute } from '../src/features/following/handler';
import {
  createAudienceSnapshotRoute,
  readAudienceForViewer,
} from '../src/features/spectating/audience-snapshot';
import { createViewerPulseRoute } from '../src/features/viewer-counts/handler';
import { VIEWER_BUCKET_MS } from '../src/features/viewer-counts/viewer-count';
import { createRateLimiter } from '../src/server/rate-limit';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { assembleJudgedRoom } from './round-judging.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

const origin = 'http://audience.test';
type Runtime = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

/** An account that was never admitted: it has a username and nothing else. */
const unadmitted = async (f: Runtime) => {
  const userId = createId();
  const actorId = createId();
  await f.sql`insert into users (id,username,email_verified) values (${userId},${`u-${userId}`},true)`;
  await f.sql`insert into actors (id,kind,user_id) values (${actorId},'human',${userId})`;
  return { userId, actorId, username: `u-${userId}` };
};

const onAirRound = async (f: Runtime, debatersReadChat = false) => {
  const { actorId: judgeId } = await f.aiJudge();
  let view = await assembleJudgedRoom(f);
  view = (
    await f.command(f.host, view, {
      type: 'assign-seat',
      actorId: judgeId,
      role: 'judge',
      slot: 0,
    })
  ).view;
  for (const seat of [f.host, f.guest])
    view = (await f.consent(seat, view, 'ready')).view;
  const { roundId } = await launchRuntimeRound(f, view);
  await f.sql`insert into broadcasts (feed_key, id, round_id,release_policy,debaters_read_chat)
    values (${createId()},${createId()},${roundId},${{ kind: 'delay', seconds: 60 }},${debatersReadChat})`;
  return roundId;
};

const cleanup = async (f: Runtime, roundId: string, users: string[]) => {
  await f.sql`delete from messaging_channels where round_id=${roundId}`;
  await f.sql`delete from content_reports where target_kind='chat_message'`;
  await f.sql`delete from audience_reactions where round_id=${roundId}`;
  await f.sql`delete from broadcasts where round_id=${roundId}`;
  for (const id of users) {
    await f.sql`delete from audience_bans where user_id=${id}`;
    await f.sql`delete from debater_follows where follower_user_id=${id}`;
    await f.sql`delete from actors where user_id=${id}`;
    await f.sql`delete from users where id=${id}`;
  }
};

const routes = (
  f: Runtime,
  signedIn: () => { userId: string; actorId: string | null } | null,
  now: () => string,
) => {
  const account = {
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => {
      const who = signedIn();
      return who
        ? ({
            state: 'member',
            principal: {
              kind: 'user',
              userId: who.userId,
              actorId: who.actorId,
            },
          } as never)
        : ({ state: 'anonymous', principal: { kind: 'anonymous' } } as never);
    },
    limiter: () => createRateLimiter(f.redis),
  };
  const clock = { now };
  return {
    chat: createSpectatorChatRoute({
      ...account,
      store: f.store,
      clock,
      ids: { next: createId },
    }),
    reaction: createAudienceReactionRoute({
      ...account,
      store: f.store,
      clock,
      ids: { next: createId },
    }),
    follow: createDebaterFollowRoute({ ...account, store: f.store }),
    pulse: createViewerPulseRoute({
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: account.origin,
      limiter: account.limiter,
      clock,
      store: f.store,
      counts: f.redis,
    }),
    report: createReportHandler({
      ...account,
      store: f.store,
      nextId: createId,
    }),
    snapshot: createAudienceSnapshotRoute({
      logger: silentLogger,
      reporter: noopErrorReporter,
      store: f.store,
      counts: f.redis,
      clock,
    }),
  };
};

const postTo = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const chatBody = (text: string, requestId: string = createId()) => ({
  version: 1,
  requestId,
  text,
});

const NOW = '2026-11-03T12:00:00.000Z';
const secondsAfter = (seconds: number) =>
  new Date(Date.parse(NOW) + seconds * 1000).toISOString();

test('an account that was never admitted posts through the route, and no one reads it before release', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await onAirRound(f);
    const poster = await unadmitted(f);
    const reporter = await unadmitted(f);
    let who: { userId: string; actorId: string | null } | null = poster;
    let now = NOW;
    const route = routes(
      f,
      () => who,
      () => now,
    );
    const chatPath = `/api/rounds/${roundId}/chat`;
    try {
      who = null;
      const anonymous = await route.chat(postTo(chatPath, chatBody('No name')));
      who = poster;
      const foreign = await route.chat(
        postTo(chatPath, chatBody('Other site'), {
          origin: 'http://other.test',
        }),
      );
      const requestId = createId();
      const posted = await route.chat(
        postTo(chatPath, chatBody('A released line', requestId)),
      );
      const { messageId } = (await posted.json()) as { messageId: string };
      const replay = await route.chat(
        postTo(chatPath, chatBody('A released line', requestId)),
      );
      const held = audienceSnapshotSchema.parse(
        await (
          await route.snapshot(
            new Request(`${origin}/api/rounds/${roundId}/audience`),
            roundId,
          )
        ).json(),
      );
      assert({
        given:
          'no session, a foreign origin, then an account with no admission',
        should:
          'refuse the first two, take the third once across a retry, and hold it from the audience',
        actual: {
          anonymous: anonymous.status,
          foreign: foreign.status,
          posted: posted.status,
          replay: [
            replay.status,
            ((await replay.json()) as { messageId: string }).messageId,
          ],
          held: held.messages,
          interaction: held.interaction,
        },
        expected: {
          anonymous: 401,
          foreign: 403,
          posted: 200,
          replay: [200, messageId],
          held: [],
          interaction: 'open',
        },
      });

      await f.sql`update broadcasts set released_through_at=${secondsAfter(120)} where round_id=${roundId}`;
      now = secondsAfter(121);
      const released = await readAudienceForViewer(
        { store: f.store, counts: f.redis },
        { roundId, actorId: null, now },
      );
      assert({
        given: 'the watermark past the message by the margin',
        should: 'show it to a visitor, under its author’s name',
        actual: released?.snapshot.messages.map((row) => [
          row.id,
          row.author,
          row.text,
        ]),
        expected: [[messageId, poster.username, 'A released line']],
      });

      who = reporter;
      const reported = await route.report(
        postTo('/api/content-reports', {
          targetKind: 'chat_message',
          targetId: messageId,
          reason: 'spam',
        }),
      );
      who = poster;
      const own = await route.report(
        postTo('/api/content-reports', {
          targetKind: 'chat_message',
          targetId: messageId,
          reason: 'spam',
        }),
      );
      assert({
        given: 'a report of the message by someone else, then by its author',
        should: 'reach it through the moderation port, and refuse its author',
        actual: [
          reported.status,
          own.status,
          ((await own.json()) as { refusal?: string }).refusal,
        ],
        expected: [200, 409, 'report-not-eligible'],
      });
    } finally {
      await cleanup(f, roundId, [poster.userId, reporter.userId]);
    }
  });
});

test('slow mode, a ban and the end of the Broadcast each refuse a post, with state unchanged', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await onAirRound(f);
    const poster = await unadmitted(f);
    let now = NOW;
    const route = routes(
      f,
      () => poster,
      () => now,
    );
    const chatPath = `/api/rounds/${roundId}/chat`;
    const count = async () =>
      (
        (await f.sql`select count(*)::int as c from messaging_messages m
          join messaging_channels c on c.id=m.channel_id where c.round_id=${roundId}`) as {
          c: number;
        }[]
      )[0]!.c;
    const refusal = async (response: Response) => [
      response.status,
      ((await response.json()) as { refusal?: string }).refusal,
    ];
    try {
      await f.sql`update broadcasts set chat_slow_mode_seconds=30 where round_id=${roundId}`;
      await route.chat(postTo(chatPath, chatBody('First')));
      const slowed = await route.chat(postTo(chatPath, chatBody('Too soon')));
      now = secondsAfter(31);
      const spaced = await route.chat(postTo(chatPath, chatBody('Later')));
      await f.sql`insert into audience_bans (user_id,banned_by_ref) values (${poster.userId},'operator')`;
      now = secondsAfter(62);
      const banned = await route.chat(postTo(chatPath, chatBody('Banned')));
      const bannedReaction = await route.reaction(
        postTo(`/api/rounds/${roundId}/reactions`, {
          version: 1,
          kind: 'sharp_point',
        }),
      );
      await f.sql`delete from audience_bans where user_id=${poster.userId}`;
      await f.sql`update broadcasts set stopped_at=${now},stop_reason='test' where round_id=${roundId}`;
      now = secondsAfter(93);
      const stopped = await route.chat(postTo(chatPath, chatBody('Stopped')));
      assert({
        given: 'a slow-mode window, its end, a ban, then a stopped Broadcast',
        should:
          'refuse each by name, write nothing for them, keep two messages',
        actual: {
          slowed: await refusal(slowed),
          spaced: spaced.status,
          banned: await refusal(banned),
          bannedReaction: await refusal(bannedReaction),
          stopped: await refusal(stopped),
          messages: await count(),
        },
        expected: {
          slowed: [409, 'chat-slow-mode'],
          spaced: 200,
          banned: [409, 'chat-banned'],
          bannedReaction: [409, 'reactions-banned'],
          stopped: [409, 'chat-closed'],
          messages: 2,
        },
      });
    } finally {
      await cleanup(f, roundId, [poster.userId]);
    }
  });
});

test('the route’s rate limit runs on real Redis before any work', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await onAirRound(f);
    const poster = await unadmitted(f);
    const route = routes(
      f,
      () => poster,
      () => NOW,
    );
    try {
      const statuses: number[] = [];
      for (let press = 0; press < 61; press += 1)
        statuses.push(
          (
            await route.reaction(
              postTo(`/api/rounds/${roundId}/reactions`, {
                version: 1,
                kind: 'sharp_point',
              }),
            )
          ).status,
        );
      const [row] =
        (await f.sql`select count(*)::int as c from audience_reactions
        where round_id=${roundId}`) as { c: number }[];
      assert({
        given: '61 presses in one minute and one spacing window',
        should: 'limit the last and store one reaction',
        actual: [statuses.at(0), statuses.at(59), statuses.at(60), row!.c],
        expected: [200, 200, 429, 1],
      });
    } finally {
      await cleanup(f, roundId, [poster.userId]);
    }
  });
});

test('a seat reads what the rule gives it, from the real store', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await onAirRound(f, true);
    const debater = f.host;
    const stranger = await unadmitted(f);
    const read = (actorId: string | null) =>
      readAudienceForViewer(
        { store: f.store, counts: f.redis },
        { roundId, actorId, now: NOW },
      );
    try {
      const on = await read(debater.actorId);
      await f.sql`update broadcasts set debaters_read_chat=false where round_id=${roundId}`;
      const off = await read(debater.actorId);
      const visitor = await read(null);
      const account = await read(stranger.actorId);
      assert({
        given:
          'a debater on a non-ranked Round, chat on then off, a visitor and an unseated account',
        should:
          'follow the host’s switch for the seat, and show the others all',
        actual: {
          on: on?.shown,
          off: off?.shown,
          visitor: visitor?.shown,
          account: [account?.shown.chat, account?.seated],
        },
        expected: {
          on: { chat: true, reactions: false, viewers: false },
          off: { chat: false, reactions: false, viewers: false },
          visitor: { chat: true, reactions: true, viewers: true },
          account: [true, false],
        },
      });
    } finally {
      await cleanup(f, roundId, [stranger.userId]);
    }
  });
});

test('a count gathers on real Redis, and shows only once the timeline passes its bucket', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await onAirRound(f);
    const nowMs =
      Math.floor(Date.parse(NOW) / VIEWER_BUCKET_MS) * VIEWER_BUCKET_MS;
    let now = new Date(nowMs + 1000).toISOString();
    const route = routes(
      f,
      () => null,
      () => now,
    );
    try {
      for (const token of [createId(), createId()])
        await route.pulse(
          postTo(`/api/rounds/${roundId}/viewers`, { version: 1, token }),
        );
      const read = () =>
        readAudienceForViewer(
          { store: f.store, counts: f.redis },
          { roundId, actorId: null, now },
        );
      const live = await read();
      await f.sql`update broadcasts set released_through_at=${new Date(
        nowMs + VIEWER_BUCKET_MS + 15_000,
      ).toISOString()} where round_id=${roundId}`;
      now = new Date(nowMs + 3 * VIEWER_BUCKET_MS).toISOString();
      const released = await read();
      assert({
        given:
          'two tabs pulsing, before and after the timeline passes that bucket',
        should: 'show no count, then two',
        actual: [live?.snapshot.viewers, released?.snapshot.viewers],
        expected: [null, 2],
      });
    } finally {
      await cleanup(f, roundId, []);
    }
  });
});

test('a pulse stores nothing for a Round off the air', async () => {
  await withRoomRuntime(async (f) => {
    const route = routes(
      f,
      () => null,
      () => NOW,
    );
    const roundId = createId();
    const response = await route.pulse(
      postTo(`/api/rounds/${roundId}/viewers`, {
        version: 1,
        token: createId(),
      }),
    );
    assert({
      given: 'a pulse naming no Broadcast',
      should: 'answer the same, leaving Redis without that key',
      actual: [
        response.status,
        await f.redis.readViewerCount(
          roundId,
          Math.floor(Date.parse(NOW) / VIEWER_BUCKET_MS),
        ),
      ],
      expected: [204, 0],
    });
  });
});
