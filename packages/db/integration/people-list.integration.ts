import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  createChallengeStore,
  listChallenges,
  purgeExpiredChallenges,
} from '../src/challenges/store';
import { readChosenStatus, writeChosenStatus } from '../src/presence/settings';
import { readPeopleListPage } from '../src/presence/people-list';
import { createReportStore, reportOperations } from '../src/reports/store';
import { contactReactions } from '../src/contact-composition';
import { createContactStore } from '../src/contacts/store';
import { loadAuthorizationAccount } from '../src/authorization';
import { memberCardOperations } from '../src/member-cards';
import { ratingVisibilityOperations } from '../src/ratings-visibility';
import { reportsPrivacyAdopter } from '../src/reports/privacy';
import { moderationPrivacyAdopter } from '../src/moderation/privacy';
import { moderationOperations } from '../src/moderation/store';
import {
  moderationReactions,
  type RestrictionRules,
} from '../src/moderation-composition';
import { admitParticipants } from '../src/beta-access-testing';
import { createMessagingTestFixture } from '../src/testing';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
/** These suites have no Round or Room: the engine's rules are never reached. */
const restrictionRules: RestrictionRules = {
  releaseMember: (room) => room,
  activeRoomMembers: () => [],
  forfeitRound: () => null,
};
const { databaseUrl } = requireTestServices(process.env);
const unfenced = async () => {};

const open = async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  return {
    client,
    database,
    cleanup: fixture.cleanup,
    me: { actorId: fixture.actorId!, userId: fixture.userId! },
    them: { actorId: fixture.otherActorId!, userId: fixture.otherUserId! },
    low: fixture.low!,
    high: fixture.high!,
    now: fixture.now,
  };
};

const page = (
  ctx: Awaited<ReturnType<typeof open>>,
  over: Partial<Parameters<typeof readPeopleListPage>[2]> = {},
) =>
  readPeopleListPage(
    ctx.database,
    ctx.me,
    {
      onlineActorIds: [ctx.me.actorId, ctx.them.actorId],
      admittedAgeBands: ['16-17', 'adult'],
      now: ctx.now,
      filter: 'all',
      // Other suites' members share this database: read only this fixture's.
      query: ctx.them.userId,
      after: null,
      limit: 10,
      ...over,
    },
    unfenced,
  );

test('the people list shows everyone, online or not, except the reader and a blocked pair', async () => {
  const ctx = await open();
  try {
    const seen = async () =>
      (await page(ctx)).rows.map((row) => [row.actorId, row.online]);
    const reader = await page(ctx, { query: ctx.me.userId });
    const open_ = await seen();
    // Counts span the shared database, but only these ids hold a lease here.
    const onlineCount = async () => (await page(ctx)).counts.online;
    const leased = await onlineCount();
    const unleased = await page(ctx, { onlineActorIds: [] });
    await writeChosenStatus(
      ctx.database,
      ctx.them,
      { status: 'appearing_offline', now: ctx.now },
      unfenced,
    );
    const offline = await seen();
    const appearingOffline = await onlineCount();
    await writeChosenStatus(
      ctx.database,
      ctx.them,
      { status: 'busy', now: ctx.now },
      unfenced,
    );
    const busy = await page(ctx);
    await createContactStore({
      database: ctx.database,
      authorize: unfenced,
      reactions: contactReactions,
    }).withContacts(
      {
        ...ctx.them,
        memberActorIds: [ctx.me.actorId, ctx.them.actorId],
      },
      (frame) =>
        frame.commitBlock({
          requestId: createId(),
          blocked: true,
          digest: 'a'.repeat(64),
          now: ctx.now,
        }),
    );
    const blocked = await page(ctx);
    assert({
      given:
        'the other member online, with no lease, appearing offline, Busy, then blocking the reader',
      should:
        'never list the reader; list them online, offline, offline, Busy, then hide them both ways, counting them online only while they show as online',
      actual: [
        reader.rows,
        open_,
        unleased.rows.map((row) => [row.actorId, row.online]),
        offline,
        busy.rows.map((row) => [row.chosen, row.online]),
        blocked.rows,
        [
          leased,
          unleased.counts.online,
          appearingOffline,
          busy.counts.online,
          blocked.counts.online,
          blocked.counts.friends,
        ],
      ],
      expected: [
        [],
        [[ctx.them.actorId, true]],
        [[ctx.them.actorId, false]],
        [[ctx.them.actorId, false]],
        [['busy', true]],
        [],
        [1, 0, 0, 1, 0, 0],
      ],
    });
  } finally {
    await ctx.cleanup();
    await ctx.client.close();
  }
});

test('the people list counts, and orders friends, then online, then by name, across pages', async () => {
  const ctx = await open();
  const others = [createId(), createId()].map((id) => ({
    userId: id,
    actorId: createId(),
    username: `${ctx.me.userId.slice(0, 12)}${id.slice(0, 8)}`,
  }));
  try {
    for (const other of others) {
      await ctx.client.unsafe(
        'insert into users(id,username,email_verified) values($1,$2,true)',
        [other.userId, other.username],
      );
      await ctx.client.unsafe(
        "insert into actors(id,kind,user_id) values($1,'human',$2)",
        [other.actorId, other.userId],
      );
    }
    await admitParticipants(
      ctx.client,
      others.map((other) => other.userId),
      ctx.now,
    );
    const [first, second] = [...others].sort((a, b) =>
      a.username < b.username ? -1 : 1,
    );
    const base = {
      onlineActorIds: [second!.actorId],
      query: ctx.me.userId.slice(0, 12),
    };
    const before = await page(ctx, base);
    const one = await page(ctx, { ...base, limit: 1 });
    const cursor = one.rows[0]!;
    const two = await page(ctx, {
      ...base,
      limit: 1,
      after: {
        friend: cursor.friend,
        online: cursor.online,
        username: cursor.username,
        actorId: cursor.actorId,
      },
    });
    assert({
      given: 'two named members, the later name online and the earlier not',
      should:
        'list the online one first, page without repeating, and count exactly that one online',
      actual: [
        before.rows.map((row) => row.actorId).slice(0, 2),
        two.rows.map((row) => row.actorId),
        before.counts.online,
        before.counts.everyone >= 2,
      ],
      expected: [[second!.actorId, first!.actorId], [first!.actorId], 1, true],
    });
  } finally {
    for (const other of others) {
      await ctx.client.unsafe('delete from actors where id = $1', [
        other.actorId,
      ]);
      await ctx.client.unsafe(
        'delete from account_beta_access where user_id = $1',
        [other.userId],
      );
      await ctx.client.unsafe('delete from users where id = $1', [
        other.userId,
      ]);
    }
    await ctx.cleanup();
    await ctx.client.close();
  }
});

test('the people list leaves out a member who could not sign in', async () => {
  const listed = async (ctx: Awaited<ReturnType<typeof open>>) =>
    (await page(ctx)).rows.length;
  const withdrawn = await open();
  const banned = await open();
  const closed = await open();
  try {
    const admitted = await listed(withdrawn);
    await withdrawn.client.unsafe(
      "update account_beta_access set state = 'revoked' where user_id = $1",
      [withdrawn.them.userId],
    );
    await banned.client.unsafe(
      `insert into moderation_actions (id, user_id, kind, starts_at, operator_ref)
       values ($1, $2, 'ban', $3, 'test')`,
      [createId(), banned.them.userId, banned.now],
    );
    await closed.client.unsafe(
      'update users set deleted_at = now() where id = $1',
      [closed.them.userId],
    );
    assert({
      given:
        'an admitted member, then one withdrawn from the beta, one banned and one closed',
      should: 'list only the admitted member',
      actual: [
        admitted,
        await listed(withdrawn),
        await listed(banned),
        await listed(closed),
      ],
      expected: [1, 0, 0, 0],
    });
  } finally {
    for (const ctx of [withdrawn, banned, closed]) {
      await ctx.cleanup();
      await ctx.client.close();
    }
  }
});

test('the people list leaves out an approved account the age rule does not admit', async () => {
  const contexts = [await open(), await open(), await open()] as const;
  const [unrecorded, underFloor, oldEnough] = contexts;
  const listed = async (ctx: Awaited<ReturnType<typeof open>>) =>
    (await page(ctx)).rows.length;
  const online = async (ctx: Awaited<ReturnType<typeof open>>) =>
    (await page(ctx, { onlineActorIds: [ctx.them.actorId] })).counts.online;
  try {
    // The grandfathered cohort was approved with no age check.
    await unrecorded.client.unsafe(
      'delete from account_age where user_id = $1',
      [unrecorded.them.userId],
    );
    await underFloor.client.unsafe(
      "update account_age set birth_month = '2012-01' where user_id = $1",
      [underFloor.them.userId],
    );
    await oldEnough.client.unsafe(
      "update account_age set birth_month = '2010-01' where user_id = $1",
      [oldEnough.them.userId],
    );
    assert({
      given:
        'approved accounts with no age record, in the 13-15 band, and in the 16-17 band',
      should: 'list and count only the one the age floor admits',
      actual: [
        await listed(unrecorded),
        await online(unrecorded),
        await listed(underFloor),
        await online(underFloor),
        await listed(oldEnough),
        await online(oldEnough),
      ],
      expected: [0, 0, 0, 0, 1, 1],
    });
  } finally {
    for (const ctx of contexts) {
      await ctx.cleanup();
      await ctx.client.close();
    }
  }
});

test('the web role can run the people list read', async () => {
  const ctx = await open();
  try {
    const rows = await ctx.database.transaction(async (tx) => {
      await tx.execute(sql`set local role daisy_web`);
      return (
        await readPeopleListPage(
          tx as never,
          ctx.me,
          {
            onlineActorIds: [ctx.them.actorId],
            admittedAgeBands: ['16-17', 'adult'],
            now: ctx.now,
            filter: 'all',
            query: ctx.them.userId,
            after: null,
            limit: 10,
          },
          unfenced,
        )
      ).rows;
    });
    assert({
      given: 'the read running as the production web role',
      should: 'answer the row, carrying no age or birth data',
      actual: rows.map((row) => Object.keys(row).sort()),
      expected: [
        [
          'actorId',
          'chosen',
          'friend',
          'friendshipState',
          'online',
          'placement',
          'requesterActorId',
          'username',
        ],
      ],
    });
  } finally {
    await ctx.cleanup();
    await ctx.client.close();
  }
});

test('an active Room is a placement: room while open, round once launched', async () => {
  const ctx = await open();
  await withFixture(databaseUrl, async (fixture) => {
    const roomId = await fixture.room(ctx.them.actorId, 'freestyle');
    await ctx.client.unsafe(
      'insert into room_active_memberships (actor_id, room_id) values ($1, $2)',
      [ctx.them.actorId, roomId],
    );
    const placement = async () => (await page(ctx)).rows[0]?.placement;
    const inRoom = await placement();
    await ctx.client.unsafe(
      "update rooms set status = 'started' where id = $1",
      [roomId],
    );
    const inRound = await placement();
    await ctx.client.unsafe(
      'delete from room_active_memberships where actor_id = $1',
      [ctx.them.actorId],
    );
    assert({
      given: 'a member holding an assembling Room, then the same Room launched',
      should: 'read as in a room, then in a round',
      actual: [inRoom, inRound],
      expected: ['room', 'round'],
    });
  });
  await ctx.cleanup();
  await ctx.client.close();
});

test('a card reads a page of people, whatever they have played', async () => {
  const ctx = await open();
  const cards = ratingVisibilityOperations({ database: ctx.database });
  const memberCards = memberCardOperations({ database: ctx.database });
  try {
    const clock = { now: ctx.now, rankedDelaySeconds: 60 };
    const none = await memberCards.readMemberCards([], clock);
    const empty = await memberCards.readMemberCards([ctx.them.actorId], clock);
    await cards.writeRatingVisibility(
      ctx.them,
      { showPolicy: true, showValue: false, now: ctx.now },
      unfenced,
    );
    const shown = await memberCards.readMemberCards([ctx.them.actorId], clock);
    const own = await cards.readRatingVisibility(ctx.them, unfenced);
    assert({
      given: 'nobody, a member with nothing played, then one turning Policy on',
      should: 'answer empty pages, then their choice',
      actual: [none, empty, shown.visibility.map((v) => v.showPolicy), own],
      expected: [
        { ratings: [], records: [], visibility: [] },
        { ratings: [], records: [], visibility: [] },
        [true],
        { showPolicy: true, showValue: false },
      ],
    });
  } finally {
    await ctx.client.unsafe(
      'delete from rating_visibility where actor_id = $1',
      [ctx.them.actorId],
    );
    await ctx.cleanup();
    await ctx.client.close();
  }
});

test('a challenge is offered, listed both ways, repeated once, and goes on decline', async () => {
  const ctx = await open();
  const store = createChallengeStore({
    database: ctx.database,
    authorize: unfenced,
  });
  const members = [ctx.me.actorId, ctx.them.actorId];
  const expiresAt = new Date(Date.parse(ctx.now) + 120_000).toISOString();
  const send = (id: string) =>
    store.withContacts({ ...ctx.me, memberActorIds: members }, (frame) =>
      frame.send({
        id,
        mode: 'ranked',
        format: 'policy',
        now: ctx.now,
        expiresAt,
      }),
    );
  try {
    const first = createId();
    const sent = await send(first);
    const repeat = await send(createId());
    const mine = await listChallenges(ctx.database, ctx.me, ctx.now, unfenced);
    const theirs = await listChallenges(
      ctx.database,
      ctx.them,
      ctx.now,
      unfenced,
    );
    await store.withContacts(
      { ...ctx.them, memberActorIds: members },
      (frame) => frame.remove({ challengeId: first, role: 'challenged' }),
    );
    const after = await listChallenges(
      ctx.database,
      ctx.them,
      ctx.now,
      unfenced,
    );
    const bells = (await ctx.client.unsafe(
      "select count(*)::int as n from outbox where kind = 'challenge.changed' and topic = any($1)",
      [`{user:${ctx.me.actorId}:inbox,user:${ctx.them.actorId}:inbox}`],
    )) as { n: number }[];
    assert({
      given: 'an offer, a repeat of it, and the other member declining',
      should:
        'keep one open offer, name it both ways, ring both bells, and leave none',
      actual: [
        sent.challengeId,
        repeat.challengeId,
        mine.map((row) => [row.direction, row.mode, row.format, row.roomId]),
        theirs.map((row) => row.direction),
        after,
        (bells[0]?.n ?? 0) >= 4,
      ],
      expected: [
        first,
        first,
        [['outgoing', 'ranked', 'policy', null]],
        ['incoming'],
        [],
        true,
      ],
    });
  } finally {
    await ctx.cleanup();
    await ctx.client.close();
  }
});

test('accepting names only a room made for the offer, and only for a free challenger', async () => {
  const ctx = await open();
  const store = createChallengeStore({
    database: ctx.database,
    authorize: unfenced,
  });
  const members = [ctx.me.actorId, ctx.them.actorId];
  const expiresAt = new Date(Date.parse(ctx.now) + 120_000).toISOString();
  const send = (mode: 'ranked' | 'casual') =>
    store.withContacts({ ...ctx.me, memberActorIds: members }, (frame) =>
      frame.send({
        id: createId(),
        mode,
        format: 'policy',
        now: ctx.now,
        expiresAt,
      }),
    );
  const accept = (challengeId: string, roomId: string) =>
    store
      .withContacts({ ...ctx.them, memberActorIds: members }, (frame) =>
        frame.accept({
          challengeId,
          roomId,
          now: ctx.now,
          followUntil: expiresAt,
        }),
      )
      .then(
        () => 'accepted',
        (error: { code?: string }) => error.code,
      );
  await withFixture(databaseUrl, async (fixture) => {
    const room = (overrides: Readonly<Record<string, unknown>>) =>
      fixture.room(ctx.them.actorId, 'policy', overrides);
    await send('ranked');
    const { challengeId } = await send('casual');
    const terms = (
      await listChallenges(ctx.database, ctx.them, ctx.now, unfenced)
    ).map((row) => row.mode);
    const unlistedRoom = await room({ visibility: 'unlisted' });
    const wrongFormat = await fixture.room(ctx.them.actorId, 'freestyle', {});
    const refused = [
      await accept(challengeId, unlistedRoom),
      await accept(challengeId, wrongFormat),
    ];
    const mine = await fixture.room(ctx.me.actorId, 'policy', {});
    await ctx.client.unsafe(
      'insert into room_active_memberships (actor_id, room_id) values ($1, $2)',
      [ctx.me.actorId, mine],
    );
    const right = await room({});
    const whilePlaced = await accept(challengeId, right);
    await ctx.client.unsafe(
      'delete from room_active_memberships where actor_id = $1',
      [ctx.me.actorId],
    );
    const accepted = await accept(challengeId, right);
    const listed = await listChallenges(
      ctx.database,
      ctx.me,
      ctx.now,
      unfenced,
    );
    const later = await listChallenges(
      ctx.database,
      ctx.me,
      new Date(Date.parse(expiresAt) + 1).toISOString(),
      unfenced,
    );
    await ctx.client.unsafe('delete from challenges where id = $1', [
      challengeId,
    ]);
    assert({
      given:
        'an offer resent as casual, an unlisted room, another format, a placed challenger, then the right (public) room',
      should:
        'take the new terms, refuse the wrong rooms and the placed challenger, accept the right room, then stop sending the challenger there',
      actual: [
        terms,
        refused,
        whilePlaced,
        accepted,
        listed.map((row) => row.roomId),
        later,
      ],
      expected: [
        ['casual'],
        ['NOT_FOUND', 'NOT_FOUND'],
        'NOT_FOUND',
        'accepted',
        [right],
        [],
      ],
    });
  });
  await ctx.cleanup();
  await ctx.client.close();
});

test('a challenge is refused while its target is Busy or appearing offline, and expires', async () => {
  const ctx = await open();
  const store = createChallengeStore({
    database: ctx.database,
    authorize: unfenced,
  });
  const members = [ctx.me.actorId, ctx.them.actorId];
  const send = (now: string) =>
    store.withContacts({ ...ctx.me, memberActorIds: members }, (frame) =>
      frame.send({
        id: createId(),
        mode: 'casual',
        format: 'freestyle',
        now,
        expiresAt: new Date(Date.parse(now) + 120_000).toISOString(),
      }),
    );
  const refused = async () =>
    send(ctx.now).then(
      () => 'sent',
      (error: { code?: string }) => error.code,
    );
  try {
    const statuses: unknown[] = [];
    for (const status of ['busy', 'appearing_offline'] as const) {
      await writeChosenStatus(
        ctx.database,
        ctx.them,
        { status, now: ctx.now },
        unfenced,
      );
      statuses.push(await refused());
    }
    await writeChosenStatus(
      ctx.database,
      ctx.them,
      { status: 'online', now: ctx.now },
      unfenced,
    );
    await send(ctx.now);
    const later = new Date(Date.parse(ctx.now) + 121_000).toISOString();
    const listed = await listChallenges(
      ctx.database,
      ctx.them,
      later,
      unfenced,
    );
    const purged = await purgeExpiredChallenges(ctx.database, {
      now: later,
      limit: 10,
    });
    assert({
      given: 'Busy, appearing offline, then an offer past its time',
      should: 'refuse alike, then stop listing it and let the sweep take it',
      actual: [statuses, listed, purged >= 1],
      expected: [['NOT_FOUND', 'NOT_FOUND'], [], true],
    });
  } finally {
    await ctx.cleanup();
    await ctx.client.close();
  }
});

test('a chosen status reads back, and a report closes once with its action', async () => {
  const ctx = await open();
  const ops = {
    ...reportOperations({ database: ctx.database, moderationReactions }),
    ...moderationOperations({ database: ctx.database }),
  };
  try {
    await writeChosenStatus(
      ctx.database,
      ctx.me,
      { status: 'busy', now: ctx.now },
      unfenced,
    );
    const chosen = await readChosenStatus(ctx.database, ctx.me, unfenced);
    const reports = createReportStore({
      database: ctx.database,
      authorize: unfenced,
    });
    const fence = {
      ...ctx.me,
      memberActorIds: [ctx.me.actorId, ctx.them.actorId],
    };
    const reportId = createId();
    const file = (id: string) =>
      reports.file(fence, {
        id,
        subjectActorId: ctx.them.actorId,
        reason: 'hate',
        surface: 'people',
        now: ctx.now,
      });
    await file(reportId);
    await file(createId());
    const queued = await ops.listOperatorReports({ limit: 100 });
    const mine = queued.filter((row) => row.id === reportId);
    const commandId = createId();
    const resolve = (id: string) =>
      ops.resolveReport({
        commandId: id,
        reportId,
        serviceId: 'daisy-admin',
        operatorRef: 'o'.repeat(24),
        resolution: {
          outcome: 'suspended',
          suspendUntil: new Date(Date.now() + 86_400_000).toISOString(),
        },
        requestDigest: 'd'.repeat(64),
        adminAuditHead: 'e'.repeat(64),
        now: new Date().toISOString(),
        purgeAfter: new Date(Date.now() + 86_400_000).toISOString(),
        nextId: createId,
        restrictionRules,
        live: () => true,
      });
    const first = await resolve(commandId);
    const replay = await resolve(commandId);
    const secondCommand = await resolve(createId()).catch(
      (error: { code?: string }) => error.code,
    );
    const account = await loadAuthorizationAccount(
      ctx.database,
      ctx.them.userId,
    );
    const restrictions = await ops.listOperatorRestrictions({
      now: new Date().toISOString(),
      limit: 100,
      after: null,
    });
    const action = restrictions.find((row) => row.userId === ctx.them.userId);
    await ops.liftModeration({
      commandId: createId(),
      actionId: action!.id,
      serviceId: 'daisy-admin',
      operatorRef: 'o'.repeat(24),
      requestDigest: 'f'.repeat(64),
      adminAuditHead: 'e'.repeat(64),
      now: new Date().toISOString(),
      live: () => true,
    });
    const lifted = await loadAuthorizationAccount(
      ctx.database,
      ctx.them.userId,
    );
    assert({
      given:
        'a report filed twice, resolved as a suspension, replayed, resolved again, then lifted',
      should:
        'queue it once, replay the same answer, refuse a second decision, restrict the account, and lift it',
      actual: [
        chosen,
        mine.length,
        first,
        replay,
        secondCommand,
        account?.restricted,
        action?.kind,
        lifted?.restricted,
      ],
      expected: [
        'busy',
        1,
        { commandId, reportId, outcome: 'suspended' },
        { commandId, reportId, outcome: 'suspended' },
        'CONFLICT',
        true,
        'suspension',
        false,
      ],
    });
  } finally {
    await ctx.cleanup();
    await ctx.client.close();
  }
});

test('a suspension ends the member’s offers, and closing an account keeps the record', async () => {
  const ctx = await open();
  const ops = {
    ...reportOperations({ database: ctx.database, moderationReactions }),
    ...moderationOperations({ database: ctx.database }),
  };
  const challengesStore = createChallengeStore({
    database: ctx.database,
    authorize: unfenced,
  });
  const reports = createReportStore({
    database: ctx.database,
    authorize: unfenced,
  });
  const members = [ctx.me.actorId, ctx.them.actorId];
  const live = new Date().toISOString();
  try {
    await challengesStore.withContacts(
      { ...ctx.them, memberActorIds: members },
      (frame) =>
        frame.send({
          id: createId(),
          mode: 'casual',
          format: 'value',
          now: live,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        }),
    );
    const before = await listChallenges(ctx.database, ctx.me, live, unfenced);
    const about = createId();
    const filed = createId();
    await reports.file(
      { ...ctx.me, memberActorIds: members },
      {
        id: about,
        subjectActorId: ctx.them.actorId,
        reason: 'spam',
        surface: 'people',
        now: live,
      },
    );
    await reports.file(
      { ...ctx.them, memberActorIds: members },
      {
        id: filed,
        subjectActorId: ctx.me.actorId,
        reason: 'spam',
        surface: 'profile',
        now: live,
      },
    );
    await ops.resolveReport({
      commandId: createId(),
      reportId: about,
      serviceId: 'daisy-admin',
      operatorRef: 'o'.repeat(24),
      resolution: {
        outcome: 'suspended',
        suspendUntil: new Date(Date.now() + 86_400_000).toISOString(),
      },
      requestDigest: 'c'.repeat(64),
      adminAuditHead: 'e'.repeat(64),
      now: live,
      purgeAfter: new Date(Date.now() + 86_400_000).toISOString(),
      nextId: createId,
      restrictionRules,
      live: () => true,
    });
    const after = await listChallenges(ctx.database, ctx.me, live, unfenced);
    const end = await ops.readRestrictionEnd({
      userId: ctx.them.userId,
      now: live,
    });
    await ctx.database.transaction(async (tx) => {
      await reportsPrivacyAdopter.erase(
        tx,
        ctx.them as never,
        { now: live } as never,
      );
      await moderationPrivacyAdopter.erase(
        tx,
        ctx.them as never,
        { now: live } as never,
      );
    });
    const [stillFiled] = (await ctx.client.unsafe(
      'select reporter_actor_id as reporter from reports where id = $1',
      [filed],
    )) as { reporter: string | null }[];
    const [stillAbout] = (await ctx.client.unsafe(
      'select outcome from reports where id = $1',
      [about],
    )) as { outcome: string }[];
    const sanctions = (await ctx.client.unsafe(
      'select kind from moderation_actions where user_id = $1',
      [ctx.them.userId],
    )) as { kind: string }[];
    assert({
      given:
        'an offer from a member who is then suspended, and who then closes their account',
      should:
        'end the offer, say when the suspension ends, keep the report about them and the sanction, and take their name off the report they filed',
      actual: [
        before.length,
        after,
        typeof end,
        stillFiled?.reporter,
        stillAbout?.outcome,
        sanctions.map((row) => row.kind),
      ],
      expected: [1, [], 'string', null, 'suspended', ['suspension']],
    });
  } finally {
    await ctx.client.unsafe(
      'delete from moderation_actions where user_id = $1',
      [ctx.them.userId],
    );
    await ctx.cleanup();
    await ctx.client.close();
  }
});

test('moderation: a ban has no end, the sweep counts from erasure, and impossible rows are refused', async () => {
  const ctx = await open();
  const ops = moderationOperations({ database: ctx.database });
  const { userId } = ctx.them;
  try {
    const sanction = (kind: string, endsAt: string | null) =>
      ctx.client.unsafe(
        `insert into moderation_actions (id, user_id, kind, starts_at, ends_at, operator_ref)
         values ($1, $2, $3, now() - interval '13 months', $4, 'op')`,
        [createId(), userId, kind, endsAt],
      );
    const now = new Date().toISOString();
    await sanction(
      'suspension',
      new Date(Date.now() + 86_400_000).toISOString(),
    );
    const suspended = await ops.readRestrictionEnd({ userId, now });
    await sanction('ban', null);
    const banned = await ops.readRestrictionEnd({ userId, now });
    const refused = (kind: string, column: string) =>
      ctx.client
        .unsafe(
          `insert into moderation_actions (id, user_id, kind, starts_at, ${column}, operator_ref)
           values ($1, $2, $3, now(), now(), 'op')`,
          [createId(), userId, kind],
        )
        .then(
          () => false,
          () => true,
        );
    const liftWarning = await refused('warning', 'lifted_at');
    const acknowledgeBan = await refused('ban', 'acknowledged_at');
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const notErased = await ops.purgeErasedModeration({
      before: dayAgo,
      limit: 100,
    });
    await ctx.client.unsafe(
      `update users set deleted_at = now() - interval '2 days', email = null, image = null, name = '' where id = $1`,
      [userId],
    );
    const stillKept = await ops.purgeErasedModeration({
      before: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      limit: 100,
    });
    const swept = await ops.purgeErasedModeration({
      before: dayAgo,
      limit: 100,
    });
    assert({
      given: 'a suspension, then a ban, on a member erased later',
      should:
        'name an end only without a ban, refuse a lifted warning and an acknowledged ban, and sweep only past the erasure date',
      actual: [
        typeof suspended,
        banned,
        liftWarning,
        acknowledgeBan,
        notErased,
        stillKept,
        swept,
      ],
      expected: ['string', null, true, true, 0, 0, 2],
    });
  } finally {
    await ctx.client.unsafe(
      'delete from moderation_actions where user_id = $1',
      [userId],
    );
    await ctx.cleanup();
    await ctx.client.close();
  }
});
