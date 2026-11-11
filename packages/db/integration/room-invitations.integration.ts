import { requireTestServices } from '@daisy/config';
import {
  activeRoomMembers,
  decideInvitationEnd,
  decideRoomInvitation,
  releaseRestrictedMember,
} from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { notificationOperations } from '../src/notifications';
import { roomCommandTransaction } from '../src/room-command-transaction';
import {
  roomInvitationOperations,
  settleRoomInvitationsAfter,
} from '../src/room-invitations/store';
import { roomFacts } from '../src/room-command-facts';
import { releaseMemberFromRooms } from '../src/room-restriction-release';
import { rooms } from '../src/schema/rooms';
import { eq } from 'drizzle-orm';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture, type Fixture } from './constraint-helpers';
import { validConfig, validRules } from './round-fixtures';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const withRoom = (
  body: (env: {
    readonly f: Fixture;
    readonly host: { userId: string; actorId: string };
    readonly coach: { userId: string; actorId: string };
    readonly roomId: string;
    readonly invitations: ReturnType<typeof roomInvitationOperations>;
    readonly notifications: ReturnType<typeof notificationOperations>;
    readonly database: ReturnType<typeof drizzle>;
  }) => Promise<void>,
) =>
  withFixture(databaseUrl, async (f) => {
    const host = await createAuthorizationSubject(f);
    const coach = await createAuthorizationSubject(f);
    await f.sql`update users set email=${`${coach.userId}@daisy.test`} where id=${coach.userId}`;
    const roomId = await f.room(host.actorId, await f.format(), {
      config: validConfig,
      execution_plan: {
        preRoundPrep: { enabled: false },
        resolutionDraw: { enabled: false },
      },
      rules_snapshot: {
        ...validRules,
        seats: { ...validRules.seats, judge: 1 },
      },
    });
    const database = drizzle({ client: f.sql });
    try {
      await body({
        f,
        host,
        coach,
        roomId,
        database,
        invitations: roomInvitationOperations({
          database,
          transaction: roomCommandTransaction(f.sql, 2),
        }),
        notifications: notificationOperations({ database }),
      });
    } finally {
      // Every signal this suite rang: the Room's doorbell and its invitees' bells.
      await f.sql`delete from outbox where topic=${`room:${roomId}`}
        or (payload->>'kind'='user.notification-delivered' and (payload->'ids'->>0) in
          (select n.id from notifications n join room_invitations i on i.id=n.room_invitation_id
            where i.room_id=${roomId}))`;
    }
  });

const invite = (
  env: Parameters<Parameters<typeof withRoom>[0]>[0],
  username: string,
  seat: 'debater' | 'judge' = 'judge',
) =>
  env.invitations.inviteToRoom({
    caller: env.host,
    roomId: env.roomId,
    username,
    seat,
    ids: {
      invitation: createId(),
      notification: createId(),
      emailJob: createId(),
    },
    admitted: (account) => account?.beta?.state === 'approved',
    decide: (facts) =>
      decideRoomInvitation({ ...facts, callerActorId: env.host.actorId, seat }),
  });

test('an invitation holds the judge seat and tells the invitee in the same transaction', async () => {
  await withRoom(async (env) => {
    const { invitationId } = await invite(env, env.coach.userId);
    const again = await invite(env, env.coach.userId);
    const holds = await env.f
      .sql`select actor_id,seat from room_seat_holds where room_id=${env.roomId}`;
    const inbox = await env.notifications.readNotifications({
      userId: env.coach.userId,
      unreadOnly: false,
      limit: 10,
      now: new Date().toISOString(),
    });
    const signals = await env.f.sql`select payload from outbox
      where topic=${`user:${env.coach.actorId}:inbox`} and kind='user.notification-delivered'`;
    const [claim] = await env.notifications.claimNotificationEmails({
      limit: 5,
      leaseMs: 10_000,
      maxAttempts: 8,
      nextToken: () => 't'.repeat(48),
    });
    const delivery = claim
      ? await env.notifications.readNotificationEmailDelivery(claim.id)
      : null;
    assert({
      given: 'a host inviting a member to judge, twice',
      should:
        'hold the judge seat, write one inbox row, one content-free signal and one email job, and answer the repeat with the same invitation',
      actual: {
        repeat: again.invitationId === invitationId,
        holds: holds.map((row: { actor_id: string; seat: string }) => [
          row.actor_id,
          row.seat,
        ]),
        inbox: inbox.rows.map((row) =>
          row.kind === 'room_invitation'
            ? [row.kind, row.roomId, row.seat, row.host]
            : [row.kind],
        ),
        signals: signals.length,
        delivery:
          delivery?.kind === 'room_invitation'
            ? [delivery.to, delivery.host, delivery.seat]
            : delivery,
      },
      expected: {
        repeat: true,
        holds: [[env.coach.actorId, 'judge']],
        inbox: [['room_invitation', env.roomId, 'judge', env.host.userId]],
        signals: 1,
        delivery: [`${env.coach.userId}@daisy.test`, env.host.userId, 'judge'],
      },
    });
  });
});

test('an invitation ends: declined, then accepted by taking the seat, then expired by the Room', async () => {
  await withRoom(async (env) => {
    const first = await invite(env, env.coach.userId);
    await env.invitations.endRoomInvitation({
      caller: env.coach,
      invitationId: first.invitationId,
      end: 'decline',
      decide: (facts) =>
        decideInvitationEnd({
          ...facts,
          callerActorId: env.coach.actorId,
          end: 'decline',
        }),
    });
    const afterDecline = await env.f
      .sql`select state from room_invitations where id=${first.invitationId}`;
    const holdsAfterDecline = await env.f
      .sql`select 1 from room_seat_holds where room_id=${env.roomId}`;
    const second = await invite(env, env.coach.userId);
    const now = new Date().toISOString();
    const [row] = await env.database
      .select()
      .from(rooms)
      .where(eq(rooms.id, env.roomId));
    const { state } = await roomFacts(env.database as never, row!);
    await settleRoomInvitationsAfter(
      env.database as never,
      {
        ...state,
        participants: [
          {
            id: createId(),
            actorId: env.coach.actorId,
            label: 'coach',
            kind: 'human',
            role: 'judge',
            slot: 0,
            eligible: true,
            consentVersion: 0,
            consentCommandId: null,
          },
        ],
      },
      now,
    );
    const accepted = await env.f
      .sql`select state from room_invitations where id=${second.invitationId}`;
    const debater = await createAuthorizationSubject(env.f);
    const third = await invite(env, debater.userId, 'debater');
    await settleRoomInvitationsAfter(
      env.database as never,
      { ...state, status: 'closed' },
      now,
    );
    const expired = await env.f
      .sql`select state from room_invitations where id=${third.invitationId}`;
    const holds = await env.f
      .sql`select 1 from room_seat_holds where room_id=${env.roomId}`;
    assert({
      given:
        'a decline, a seat taken by the invited judge, and a Room that closed',
      should: 'end each as declined, accepted and expired, freeing every hold',
      actual: {
        states: [afterDecline, accepted, expired].map(
          (rows) => (rows as { state: string }[])[0]?.state,
        ),
        holdsAfterDecline: holdsAfterDecline.length,
        holds: holds.length,
      },
      expected: {
        states: ['declined', 'accepted', 'expired'],
        holdsAfterDecline: 0,
        holds: 0,
      },
    });
  });
});

test('who cannot be invited changes nothing', async () => {
  await withRoom(async (env) => {
    const refusal = async (work: () => Promise<unknown>) =>
      work().then(
        () => 'ok',
        (error: { reason?: string }) => error.reason ?? 'error',
      );
    const pending = await createAuthorizationSubject(env.f, 'pending');
    assert({
      given: 'an unknown name, a member not admitted, and the host themself',
      should: 'refuse each with its reason and write nothing',
      actual: [
        await refusal(() => invite(env, 'nobody-here')),
        await refusal(() => invite(env, pending.userId)),
        await refusal(() => invite(env, env.host.userId)),
        (
          await env.f
            .sql`select 1 from room_invitations where room_id=${env.roomId}`
        ).length,
      ],
      expected: [
        'member-unknown',
        'member-unavailable',
        'member-unavailable',
        0,
      ],
    });
  });
});

test('a restriction ends the invitations its member sent or received', async () => {
  await withRoom(async (env) => {
    const restrict = (actorId: string) =>
      env.f.sql.begin((tx) =>
        releaseMemberFromRooms(
          drizzle({ client: tx }) as unknown as Parameters<
            typeof releaseMemberFromRooms
          >[0],
          actorId,
          {
            now: new Date().toISOString(),
            rules: {
              releaseMember: releaseRestrictedMember,
              activeRoomMembers,
            },
          },
        ),
      );
    const state = async () => ({
      invitations: (
        await env.f
          .sql`select state from room_invitations where room_id=${env.roomId} order by created_at`
      ).map((row: { state: string }) => row.state),
      holds: (
        await env.f
          .sql`select 1 from room_seat_holds where room_id=${env.roomId}`
      ).length,
    });
    await invite(env, env.coach.userId);
    await restrict(env.coach.actorId);
    const afterInvitee = await state();
    await invite(env, env.coach.userId);
    await restrict(env.host.actorId);
    const afterHost = await state();
    assert({
      given: 'an invited judge restricted, then the inviting host restricted',
      should: 'end each pending invitation and free the seat it held',
      actual: { afterInvitee, afterHost },
      expected: {
        afterInvitee: { invitations: ['expired'], holds: 0 },
        afterHost: { invitations: ['expired', 'expired'], holds: 0 },
      },
    });
  });
});

test('an invitation whose time ran out ends, and its retention clock runs', async () => {
  await withRoom(async (env) => {
    // The hold an invitation writes runs out with it.
    const lapseNow = async (id: string) => {
      await env.f
        .sql`update room_invitations set expires_at=clock_timestamp() - interval '1 minute',
        created_at=clock_timestamp() - interval '25 hours' where id=${id}`;
      await env.f.sql`update room_seat_holds h set until=i.expires_at
        from room_invitations i where i.id=${id} and h.room_id=i.room_id
          and h.actor_id=i.invitee_actor_id`;
    };
    const stateOf = async (id: string) =>
      (
        (await env.f
          .sql`select state from room_invitations where id=${id}`) as {
          state: string;
        }[]
      )[0]?.state ?? 'purged';
    const judge = await invite(env, env.coach.userId);
    await lapseNow(judge.invitationId);
    const [row] = await env.database
      .select()
      .from(rooms)
      .where(eq(rooms.id, env.roomId));
    const { state } = await roomFacts(env.database as never, row!);
    await settleRoomInvitationsAfter(
      env.database as never,
      { ...state, status: 'closed' },
      new Date().toISOString(),
    );
    const afterClose = await stateOf(judge.invitationId);
    const debater = await createAuthorizationSubject(env.f);
    const untouched = await invite(env, debater.userId, 'debater');
    await lapseNow(untouched.invitationId);
    const day = 24 * 60 * 60 * 1000;
    await env.invitations.purgeEndedRoomInvitations({
      before: new Date(Date.now() - day).toISOString(),
      limit: 500,
    });
    const swept = await stateOf(untouched.invitationId);
    const heldAfterSweep = (
      await env.f
        .sql`select 1 from room_seat_holds where room_id=${env.roomId} and actor_id=${debater.actorId}`
    ).length;
    await env.invitations.purgeEndedRoomInvitations({
      before: new Date(Date.now() + 31 * day).toISOString(),
      limit: 500,
    });
    assert({
      given:
        'a lapsed invitation in a Room that then closed, and one in a Room nothing touched',
      should:
        'expire the first on close, and the retention sweep expire the second, free the seat it held, and later purge both',
      actual: {
        afterClose,
        swept,
        heldAfterSweep,
        purged: [
          await stateOf(judge.invitationId),
          await stateOf(untouched.invitationId),
        ],
      },
      expected: {
        afterClose: 'expired',
        swept: 'expired',
        heldAfterSweep: 0,
        purged: ['purged', 'purged'],
      },
    });
  });
});

test('the retention sweep leaves alone an invitation that ended while it waited', async () => {
  await withRoom(async (env) => {
    const { invitationId } = await invite(env, env.coach.userId);
    await env.f
      .sql`update room_invitations set expires_at=clock_timestamp() - interval '1 minute',
      created_at=clock_timestamp() - interval '25 hours' where id=${invitationId}`;
    const accepting = new SQL(databaseUrl, { max: 1 });
    let sweep: Promise<number> | undefined;
    try {
      // A Room command that began before the deadline accepts the invitation
      // and commits only after the sweep has read it as pending and lapsed.
      await accepting.begin(async (tx) => {
        await tx`update room_invitations set state='accepted',ended_at=clock_timestamp() where id=${invitationId}`;
        sweep = env.invitations.purgeEndedRoomInvitations({
          before: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          limit: 500,
        });
        void sweep.catch(() => {});
        let waiting = false;
        for (let poll = 0; poll < 200 && !waiting; poll += 1) {
          const [lock] = await env.f
            .sql`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
              where not l.granted and l.locktype='transactionid' and a.datname=current_database()
                and a.query like '%update room_invitations set state=''expired''%') as waiting`;
          waiting = lock.waiting;
          if (!waiting) await Bun.sleep(10);
        }
        if (!waiting) throw new Error('The sweep did not reach the held row');
      });
      await sweep;
      const [row] = await env.f
        .sql`select state from room_invitations where id=${invitationId}`;
      assert({
        given:
          'an invitation accepted by a transaction the sweep had to wait for',
        should:
          'keep it accepted: the sweep expires only what is still pending',
        actual: row.state,
        expected: 'accepted',
      });
    } finally {
      await accepting.close();
    }
  });
});

test('a host who withdraws and invites again sends one email an hour', async () => {
  await withRoom(async (env) => {
    const withdraw = (invitationId: string) =>
      env.invitations.endRoomInvitation({
        caller: env.host,
        invitationId,
        end: 'withdraw',
        decide: (facts) =>
          decideInvitationEnd({
            ...facts,
            callerActorId: env.host.actorId,
            end: 'withdraw',
          }),
      });
    const counts = async () =>
      (
        await env.f.sql`select
          (select count(*)::int from notifications where user_id=${env.coach.userId}) as notifications,
          (select count(*)::int from notification_emails where user_id=${env.coach.userId}) as emails`
      )[0];
    const pendingId = async () =>
      (
        (await env.f.sql`select id from room_invitations
          where room_id=${env.roomId} and state='pending'`) as { id: string }[]
      )[0]!.id;
    const owed = async () =>
      (
        (await env.f.sql`select count(*)::int as n from notification_emails j
          join notifications n on n.id=j.notification_id
          join room_invitations i on i.id=n.room_invitation_id
          where j.user_id=${env.coach.userId} and i.state='pending'`) as {
          n: number;
        }[]
      )[0]!.n;
    // Withdrawn and sent again before the first email went: the live
    // invitation still owes its own (the first will be cancelled not-owed).
    await invite(env, env.coach.userId);
    await withdraw(await pendingId());
    await invite(env, env.coach.userId);
    const beforeSent = { ...(await counts()), owed: await owed() };
    // Once an email was sent, withdrawing and inviting again owes no more.
    await env.f
      .sql`update notification_emails set state='sent',completed_at=clock_timestamp()
      where user_id=${env.coach.userId}`;
    await withdraw(await pendingId());
    await invite(env, env.coach.userId);
    const reinvited = await counts();
    // An email cancelled before it went never counts as the hour's email.
    await env.f.sql`update notification_emails set state='cancelled',
      last_error_code='rate-limited',completed_at=clock_timestamp() where user_id=${env.coach.userId}`;
    await withdraw(await pendingId());
    await invite(env, env.coach.userId);
    const afterCancelled = await counts();
    // Another Room of the same host is its own invitation and its own email.
    const other = await env.f.room(env.host.actorId, await env.f.format(), {
      rules_snapshot: {
        ...validRules,
        seats: { ...validRules.seats, judge: 1 },
      },
    });
    try {
      await invite({ ...env, roomId: other }, env.coach.userId);
      const otherRoom = await counts();
      assert({
        given:
          'a reinvite before the first email went, one after an email was sent, one after it was cancelled, then an invite to another Room, all within the hour',
        should:
          'tell the member in the inbox each time, and owe the live invitation an email unless one was sent for this Room',
        actual: { beforeSent, reinvited, afterCancelled, otherRoom },
        expected: {
          beforeSent: { notifications: 2, emails: 2, owed: 1 },
          reinvited: { notifications: 3, emails: 2 },
          afterCancelled: { notifications: 4, emails: 3 },
          otherRoom: { notifications: 5, emails: 4 },
        },
      });
    } finally {
      await env.f.sql`delete from outbox where topic=${`room:${other}`}
        or (payload->>'kind'='user.notification-delivered' and (payload->'ids'->>0) in
          (select n.id from notifications n join room_invitations i on i.id=n.room_invitation_id
            where i.room_id=${other}))`;
    }
  });
});
