import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  createChallengeStore,
  listChallenges,
  purgeExpiredChallenges,
} from '../src/challenges/store';
import { readChosenStatus, writeChosenStatus } from '../src/presence/settings';
import { readRosterPage } from '../src/presence/roster';
import { createReportStore, reportOperations } from '../src/reports/store';
import { contactReactions } from '../src/contact-composition';
import { createContactStore } from '../src/contacts/store';
import { loadAuthorizationAccount } from '../src/authorization';
import { memberCardOperations } from '../src/member-cards';
import { ratingVisibilityOperations } from '../src/ratings-visibility';
import { reportsPrivacyAdopter } from '../src/reports/privacy';
import { createMessagingTestFixture } from '../src/testing';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
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
  over: Partial<Parameters<typeof readRosterPage>[2]> = {},
) =>
  readRosterPage(
    ctx.database,
    ctx.me,
    {
      onlineActorIds: [ctx.me.actorId, ctx.them.actorId],
      filter: 'all',
      query: null,
      after: null,
      limit: 10,
      ...over,
    },
    unfenced,
  );

test('the roster leaves out the reader, anyone appearing offline and a blocked pair', async () => {
  const ctx = await open();
  try {
    const seen = async () => (await page(ctx)).rows.map((row) => row.actorId);
    const open_ = await seen();
    await writeChosenStatus(
      ctx.database,
      ctx.them,
      { status: 'offline', now: ctx.now },
      unfenced,
    );
    const offline = await seen();
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
        'the other member online, then appearing offline, Busy, then blocking the reader',
      should:
        'list them, hide them, list them as Busy, then hide them both ways',
      actual: [
        open_,
        offline,
        busy.rows.map((row) => row.chosen),
        blocked.rows,
        blocked.counts,
      ],
      expected: [
        [ctx.them.actorId],
        [],
        ['busy'],
        [],
        { everyone: 0, friends: 0 },
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
    const none = await memberCards.readMemberCards([]);
    const empty = await memberCards.readMemberCards([ctx.them.actorId]);
    await cards.writeRatingVisibility(
      ctx.them,
      { showPolicy: true, showValue: false, now: ctx.now },
      unfenced,
    );
    const shown = await memberCards.readMemberCards([ctx.them.actorId]);
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
    const publicRoom = await room({});
    const wrongFormat = await fixture.room(ctx.them.actorId, 'freestyle', {
      visibility: 'unlisted',
    });
    const refused = [
      await accept(challengeId, publicRoom),
      await accept(challengeId, wrongFormat),
    ];
    const mine = await fixture.room(ctx.me.actorId, 'policy', {});
    await ctx.client.unsafe(
      'insert into room_active_memberships (actor_id, room_id) values ($1, $2)',
      [ctx.me.actorId, mine],
    );
    const right = await room({ visibility: 'unlisted' });
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
        'an offer resent as casual, a public room, another format, a placed challenger, then the right room',
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
    for (const status of ['busy', 'offline'] as const) {
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
  const ops = reportOperations({ database: ctx.database });
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
        surface: 'online',
        now: ctx.now,
      });
    await file(reportId);
    await file(createId());
    const queued = await ops.listOperatorReports({ limit: 100, after: null });
    const mine = queued.filter((row) => row.id === reportId);
    const commandId = createId();
    const resolve = (id: string) =>
      ops.resolveReport({
        commandId: id,
        reportId,
        serviceId: 'daisy-admin',
        operatorRef: 'o'.repeat(24),
        outcome: 'suspended',
        suspendUntil: new Date(Date.now() + 86_400_000).toISOString(),
        requestDigest: 'd'.repeat(64),
        adminAuditHead: 'e'.repeat(64),
        now: new Date().toISOString(),
        purgeAfter: new Date(Date.now() + 86_400_000).toISOString(),
        nextId: createId,
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
  const ops = reportOperations({ database: ctx.database });
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
        surface: 'online',
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
      outcome: 'suspended',
      suspendUntil: new Date(Date.now() + 86_400_000).toISOString(),
      requestDigest: 'c'.repeat(64),
      adminAuditHead: 'e'.repeat(64),
      now: live,
      purgeAfter: new Date(Date.now() + 86_400_000).toISOString(),
      nextId: createId,
      live: () => true,
    });
    const after = await listChallenges(ctx.database, ctx.me, live, unfenced);
    const end = await ops.readRestrictionEnd({
      userId: ctx.them.userId,
      now: live,
    });
    await ctx.database.transaction((tx) =>
      reportsPrivacyAdopter.erase(
        tx,
        ctx.them as never,
        { now: live } as never,
      ),
    );
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

const migration = '20261102222410_who_is_online';
const scratch = scratchDatabase(databaseUrl, 'whoonline');
afterAll(() => scratch.drop());

test(
  'the migration turns a hidden choice into appearing offline',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (fixture) => {
      const client = new SQL(scratch.url);
      const hiddenId = await fixture.actor();
      const shownId = await fixture.actor();
      await client.unsafe(
        'insert into presence_settings (actor_id, hidden, updated_at) values ($1, true, now()), ($2, false, now())',
        [hiddenId, shownId],
      );
      await scratch.migrate((folder) => folder <= migration);
      const rows = (await client.unsafe(
        'select actor_id as id, status from presence_settings',
      )) as { id: string; status: string }[];
      const statusOf = (id: string) =>
        rows.find((row) => row.id === id)?.status;
      assert({
        given: 'one member hiding and one not',
        should: 'keep each choice in the new column',
        actual: [statusOf(hiddenId), statusOf(shownId)],
        expected: ['offline', 'online'],
      });
      await client.unsafe(
        'delete from presence_settings where actor_id = any($1)',
        [`{${hiddenId},${shownId}}`],
      );
      await client.close();
    });
  },
  ddlTimeoutMs,
);
