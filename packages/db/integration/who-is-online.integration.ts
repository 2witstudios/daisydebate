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
    await ctx.client.unsafe("update rooms set status = 'started' where id = $1", [
      roomId,
    ]);
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
      expected: [['CONFLICT', 'CONFLICT'], [], true],
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
        undefined,
      ],
    });
  } finally {
    await ctx.cleanup();
    await ctx.client.close();
  }
});

const migration = '20261102202019_who_is_online';
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
