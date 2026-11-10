import { requireTestServices } from '@daisy/config';
import {
  decideInvitationEnd,
  decideRoomInvitation,
} from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { notificationOperations } from '../src/notifications';
import { roomCommandTransaction } from '../src/room-command-transaction';
import {
  roomInvitationOperations,
  settleRoomInvitationsAfter,
} from '../src/room-invitations/store';
import { roomFacts } from '../src/room-command-facts';
import { rooms } from '../src/schema/rooms';
import { eq } from 'drizzle-orm';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture, type Fixture } from './constraint-helpers';
import { validRules } from './round-fixtures';

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
