import { requireTestServices } from '@daisy/config';
import { noopErrorReporter } from '@daisy/observability';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAudienceReactionRoute } from '../src/features/audience-reactions/handler';
import { createReportHandler } from '../src/features/content-moderation/report-handler';
import { createSpectatorChatRoute } from '../src/features/messaging/spectator-chat/handler';
import { audienceLinkHash } from '../src/features/audience-link/audience-link';
import { createDebaterFollowRoute } from '../src/features/following/handler';
import {
  createAudienceSnapshotRoute,
  readAudienceForViewer,
  readAudienceSnapshot,
} from '../src/features/spectating/audience-snapshot';
import { createWatchHistoryRoute } from '../src/features/watch-history/handler';
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
  await f.sql`insert into broadcasts (id,round_id,feed_key,release_policy,debaters_read_chat)
    values (${createId()},${roundId},${createId()},${{ kind: 'delay', seconds: 60 }},${debatersReadChat})`;
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
      identify: account.identify,
    }),
    history: createWatchHistoryRoute({ ...account, store: f.store, clock }),
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

test('an account that was never admitted posts through the route, and the next read holds it', async () => {
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
        postTo(chatPath, chatBody('A line', requestId)),
      );
      const { messageId } = (await posted.json()) as { messageId: string };
      const replay = await route.chat(
        postTo(chatPath, chatBody('A line', requestId)),
      );
      const read = (await readAudienceSnapshot(
        { store: f.store },
        { roundId },
      ))!.snapshot;
      assert({
        given:
          'no session, a foreign origin, then an account with no admission',
        should:
          'refuse the first two, take the third once across a retry, and show it to the audience with the feed still held',
        actual: {
          anonymous: anonymous.status,
          foreign: foreign.status,
          posted: posted.status,
          replay: [
            replay.status,
            ((await replay.json()) as { messageId: string }).messageId,
          ],
          read: read.messages.map((row) => [row.id, row.author, row.text]),
          interaction: read.interaction,
        },
        expected: {
          anonymous: 401,
          foreign: 403,
          posted: 200,
          replay: [200, messageId],
          read: [[messageId, poster.username, 'A line']],
          interaction: 'open',
        },
      });

      now = secondsAfter(121);
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

test('the chat route’s own rate limit runs on real Redis before any work', async () => {
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
      for (let press = 0; press < 21; press += 1)
        statuses.push(
          (
            await route.chat(
              postTo(`/api/rounds/${roundId}/chat`, chatBody(`Line ${press}`)),
            )
          ).status,
        );
      const [row] =
        (await f.sql`select count(*)::int as c from messaging_messages m
        join messaging_channels c on c.id=m.channel_id
        where c.round_id=${roundId}`) as { c: number }[];
      assert({
        given: '21 chat posts in one minute',
        should: 'accept 20, limit the last, and store only what was accepted',
        actual: [
          statuses.slice(0, 20).every((s) => s === 200),
          statuses[20],
          row!.c,
        ],
        expected: [true, 429, 20],
      });
    } finally {
      await cleanup(f, roundId, [poster.userId]);
    }
  });
});

test('the reaction route’s rate limit runs on real Redis before any work', async () => {
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

test('nobody in the live room can react: a seat or a seatless host', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await onAirRound(f);
    const pressAs = (who: Parameters<typeof routes>[1]) =>
      routes(f, who, () => NOW).reaction(
        postTo(`/api/rounds/${roundId}/reactions`, {
          version: 1,
          kind: 'sharp_point',
        }),
      );
    const outsider = await unadmitted(f);
    const reasonOf = async (response: Response) => [
      response.status,
      response.status === 409
        ? ((await response.json()) as { refusal?: string }).refusal
        : null,
    ];
    const pressed = async () =>
      (
        (await f.sql`select count(*)::int as c from audience_reactions where round_id=${roundId}`) as {
          c: number;
        }[]
      )[0]!.c;
    try {
      assert({
        given:
          'a debater who is also its host, a seated guest, and an outsider',
        should: 'refuse both in the room by name and take the outsider press',
        actual: {
          host: await reasonOf(await pressAs(() => f.host as never)),
          guest: await reasonOf(await pressAs(() => f.guest as never)),
          outsider: (await pressAs(() => outsider)).ok,
          pressed: await pressed(),
        },
        expected: {
          host: [409, 'reactions-live-room'],
          guest: [409, 'reactions-live-room'],
          outsider: true,
          pressed: 1,
        },
      });
    } finally {
      await cleanup(f, roundId, [outsider.userId]);
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
        { store: f.store },
        { roundId, actorId, presentedHash: null },
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

test('a count gathers on real Redis and shows as soon as its bucket is whole', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await onAirRound(f);
    const nowMs =
      Math.floor(Date.parse(NOW) / VIEWER_BUCKET_MS) * VIEWER_BUCKET_MS;
    const now = new Date(nowMs + 1000).toISOString();
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
      const bucket = Math.floor(nowMs / VIEWER_BUCKET_MS);
      assert({
        given: 'two tabs pulsing',
        should: 'gather two in that bucket on real Redis, for the publisher',
        actual: await f.redis.readViewerCount(roundId, bucket),
        expected: 2,
      });
    } finally {
      await cleanup(f, roundId, []);
    }
  });
});

test('anyone in the live room is refused by name, and a viewer posts on', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await onAirRound(f, true);
    const seatlessHost = await unadmitted(f);
    const humanJudge = await unadmitted(f);
    const viewer = await unadmitted(f);
    let who: { userId: string; actorId: string | null } = viewer;
    const route = routes(
      f,
      () => who,
      () => NOW,
    );
    const postAs = async (account: typeof who) => {
      who = account;
      const response = await route.chat(
        postTo(`/api/rounds/${roundId}/chat`, chatBody('A line')),
      );
      return {
        status: response.status,
        refusal: ((await response.json()) as { refusal?: string }).refusal,
      };
    };
    try {
      await f.sql`update rounds set created_by_actor_id=${seatlessHost.actorId} where id=${roundId}`;
      await f.sql`insert into round_participants (id,round_id,actor_id,role,slot)
        values (${createId()},${roundId},${humanJudge.actorId},'judge',1)`;
      const refusedAs = { status: 409, refusal: 'chat-live-room' };
      const debater = await postAs(f.host);
      const judge = await postAs(humanJudge);
      const host = await postAs(seatlessHost);
      const channels = (await f.sql`
        select m.id from messaging_messages m join messaging_channels c on c.id=m.channel_id
        where c.round_id=${roundId}`) as unknown[];
      const posted = await postAs(viewer);
      const nonRanked = await readAudienceForViewer(
        { store: f.store },
        { roundId, actorId: f.host.actorId, presentedHash: null },
      );
      await f.sql`update rounds set competition_type='ranked',format_id='freestyle',preset_version=1,ladder_id='freestyle' where id=${roundId}`;
      const ranked = await readAudienceForViewer(
        { store: f.store },
        { roundId, actorId: f.host.actorId, presentedHash: null },
      );
      assert({
        given:
          'a debater, a judge and a seatless host, then a viewer, then a debater reading',
        should:
          'refuse the three with the same typed refusal and store nothing; the viewer posts; a non-ranked debater reads it and a ranked one does not',
        actual: {
          refused: [debater, judge, host],
          stored: channels.length,
          posted: posted.status,
          nonRanked: [
            nonRanked?.inLiveRoom,
            nonRanked?.snapshot.messages.length,
          ],
          ranked: ranked?.snapshot.messages.length,
        },
        expected: {
          refused: [refusedAs, refusedAs, refusedAs],
          stored: 0,
          posted: 200,
          nonRanked: [true, 1],
          ranked: 0,
        },
      });
    } finally {
      await f.sql`delete from round_participants where round_id=${roundId} and actor_id=${humanJudge.actorId}`;
      await f.sql`update rounds set created_by_actor_id=null where id=${roundId}`;
      await cleanup(f, roundId, [
        seatlessHost.userId,
        humanJudge.userId,
        viewer.userId,
      ]);
    }
  });
});

test('an unlisted Round: every audience route answers as missing with no link, and works with one', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = await onAirRound(f);
    const token = 'k'.repeat(43);
    const link = { cookie: `daisy_audience_link_${roundId}=${token}` };
    const stranger = await unadmitted(f);
    const reader = await unadmitted(f);
    let who: { userId: string; actorId: string | null } | null = stranger;
    const nowMs =
      Math.floor(Date.parse(NOW) / VIEWER_BUCKET_MS) * VIEWER_BUCKET_MS;
    let now = new Date(nowMs + 1000).toISOString();
    const route = routes(
      f,
      () => who,
      () => now,
    );
    // Every request has its own id; everything else must match byte for byte.
    const answer = async (response: Response) => [
      response.status,
      (await response.text()).replace(/"requestId":"[^"]+"/, ''),
      response.headers.get('Cache-Control'),
    ];
    const path = (leaf: string) => `/api/rounds/${roundId}/${leaf}`;
    const snapshot = (headers: Record<string, string> = {}) =>
      route.snapshot(
        new Request(`${origin}${path('audience')}`, { headers }),
        roundId,
      );
    const reportOn = (
      targetKind: 'round' | 'chat_message',
      targetId: string,
      headers: Record<string, string> = {},
    ) =>
      route.report(
        postTo(
          '/api/content-reports',
          { targetKind, targetId, reason: 'spam' },
          headers,
        ),
      );
    try {
      await f.sql`update rounds set visibility='unlisted', audience_link_hash=${audienceLinkHash(token)} where id=${roundId}`;
      await f.sql`update rooms set visibility='unlisted' where id=(select room_id from rounds where id=${roundId})`;

      const missingRound = createId();
      const missingChat = await route.chat(
        postTo(`/api/rounds/${missingRound}/chat`, chatBody('A line')),
      );
      const missingReaction = await route.reaction(
        postTo(`/api/rounds/${missingRound}/reactions`, {
          version: 1,
          kind: 'sharp_point',
        }),
      );
      const missingReport = await reportOn('round', missingRound);
      const missingText = {
        chat: await answer(missingChat),
        reaction: await answer(missingReaction),
        report: await answer(missingReport),
      };

      const refusedChat = await route.chat(
        postTo(path('chat'), chatBody('A line')),
      );
      const refusedReaction = await route.reaction(
        postTo(path('reactions'), { version: 1, kind: 'sharp_point' }),
      );
      const refusedReport = await reportOn('round', roundId);
      assert({
        given: 'a signed-in account with no link',
        should:
          'answer chat, reactions and a report exactly as for a Round that does not exist',
        actual: {
          chat: await answer(refusedChat),
          reaction: await answer(refusedReaction),
          report: await answer(refusedReport),
        },
        expected: missingText,
      });
      const [channels] =
        (await f.sql`select count(*)::int as c from messaging_channels where round_id=${roundId}`) as {
          c: number;
        }[];
      assert({
        given: 'those refused posts',
        should: 'open no channel',
        actual: channels!.c,
        expected: 0,
      });

      who = reader;
      const posted = await route.chat(
        postTo(path('chat'), chatBody('A held line'), link),
      );
      const { messageId } = (await posted.json()) as { messageId: string };
      const pressed = await route.reaction(
        postTo(path('reactions'), { version: 1, kind: 'sharp_point' }, link),
      );

      who = stranger;
      const reportedWithout = await reportOn('chat_message', messageId);
      const reportedWith = await reportOn('chat_message', messageId, link);
      const roundWith = await reportOn('round', roundId, link);
      assert({
        given: 'a message on the Round, reported with no link and with one',
        should:
          'answer as missing, then file; a Round report with the link files',
        actual: [
          reportedWithout.status,
          reportedWith.status,
          roundWith.status,
          posted.status,
          pressed.status,
        ],
        expected: [404, 200, 200, 200, 200],
      });

      now = new Date(nowMs + 3000).toISOString();
      const anonymous = await snapshot();
      const held = await readAudienceForViewer(
        { store: f.store },
        {
          roundId,
          actorId: null,
          presentedHash: audienceLinkHash(token),
        },
      );
      assert({
        given:
          'the route with no live room, and a render with the current link',
        should:
          'answer 404, since a viewer reads the published state, then the line and the press',
        actual: {
          anonymous: anonymous.status,
          withLink: (await snapshot(link)).status,
          lines: held?.snapshot.messages.map((row) => row.text),
          sharp: held?.snapshot.reactions.find(
            (row) => row.kind === 'sharp_point',
          )?.count,
        },
        expected: {
          anonymous: 404,
          withLink: 404,
          lines: ['A held line'],
          sharp: 1,
        },
      });

      for (const headers of [{}, link])
        await route.pulse(
          postTo(path('viewers'), { version: 1, token: createId() }, headers),
        );
      now = new Date(nowMs + VIEWER_BUCKET_MS + 2000).toISOString();
      const counted = await readAudienceForViewer(
        { store: f.store },
        {
          roundId,
          actorId: null,
          presentedHash: audienceLinkHash(token),
        },
      );
      const noLink = await readAudienceForViewer(
        { store: f.store },
        { roundId, actorId: stranger.actorId, presentedHash: null },
      );
      const debaterNoLink = await readAudienceForViewer(
        { store: f.store },
        { roundId, actorId: f.host.actorId, presentedHash: null },
      );
      assert({
        given:
          'a pulse without the link and one with it, then each kind of reader',
        should:
          'count only the holder; render nothing for a stranger, and render for a seat with no link',
        actual: {
          viewers: await f.redis.readViewerCount(
            roundId,
            Math.floor(nowMs / VIEWER_BUCKET_MS),
          ),
          noLink,
          seat: debaterNoLink?.seated,
          unlisted: debaterNoLink?.unlisted,
        },
        expected: { viewers: 1, noLink: null, seat: true, unlisted: true },
      });

      await route.history(
        postTo('/api/watch-history', { version: 1, kind: 'watched', roundId }),
      );
      const watchedWithout =
        (await f.sql`select 1 from watch_history where user_id=${stranger.userId}`) as unknown[];
      await route.history(
        postTo(
          '/api/watch-history',
          { version: 1, kind: 'watched', roundId },
          link,
        ),
      );
      const watchedWith =
        (await f.sql`select 1 from watch_history where user_id=${stranger.userId}`) as unknown[];
      assert({
        given: 'a visit recorded with no link, then with one',
        should: 'write nothing for the first, so history cannot open the Round',
        actual: [watchedWithout.length, watchedWith.length],
        expected: [0, 1],
      });
    } finally {
      await f.sql`delete from watch_history where round_id=${roundId}`;
      await f.sql`delete from content_reports where target_id=${roundId}`;
      await cleanup(f, roundId, [stranger.userId, reader.userId]);
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
