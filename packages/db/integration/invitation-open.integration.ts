import { requireTestServices } from '@daisy/config';
import { decideRoomInvitation } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { notificationOperations } from '../src/notifications';
import { roomCommandTransaction } from '../src/room-command-transaction';
import { roomInvitationOperations } from '../src/room-invitations/store';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture, type Fixture } from './constraint-helpers';
import { validConfig, validRules } from './round-fixtures';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** One invited member, and what the inbox and the email job each say of the invitation. */
const withInvitation = (
  body: (env: {
    readonly f: Fixture;
    readonly roomId: string;
    readonly invitationId: string;
    readonly standing: (now?: string) => Promise<{
      readonly inbox: boolean;
      readonly email: string;
    }>;
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
    const notifications = notificationOperations({ database });
    try {
      const { invitationId } = await roomInvitationOperations({
        database,
        transaction: roomCommandTransaction(f.sql, 2),
      }).inviteToRoom({
        caller: host,
        roomId,
        username: coach.userId,
        seat: 'judge',
        ids: {
          invitation: createId(),
          notification: createId(),
          emailJob: createId(),
        },
        admitted: (account) => account?.beta?.state === 'approved',
        decide: (facts) =>
          decideRoomInvitation({
            ...facts,
            callerActorId: host.actorId,
            seat: 'judge',
          }),
      });
      const [job] = await f.sql`select j.id from notification_emails j
        join notifications n on n.id=j.notification_id
        where n.room_invitation_id=${invitationId}`;
      await body({
        f,
        roomId,
        invitationId,
        standing: async (now = new Date().toISOString()) => ({
          inbox: (
            await notifications.readNotifications({
              userId: coach.userId,
              unreadOnly: false,
              limit: 10,
              now,
            })
          ).rows.some((row) => row.kind === 'room_invitation'),
          email: (await notifications.readNotificationEmailDelivery(job!.id))
            .kind,
        }),
      });
    } finally {
      await f.sql`delete from outbox where topic=${`room:${roomId}`}
        or (payload->>'kind'='user.notification-delivered' and (payload->'ids'->>0) in
          (select n.id from notifications n join room_invitations i on i.id=n.room_invitation_id
            where i.room_id=${roomId}))`;
    }
  });

test('an invitation is open while it is pending, unexpired and its Room is open', async () => {
  await withInvitation(async (env) => {
    const open = await env.standing();
    // A pending invitation on a Room that is no longer open: the state an
    // unsettled row would be in, which neither reader may show as open.
    await env.f.sql`update rooms set status='closed' where id=${env.roomId}`;
    const roomClosed = await env.standing();
    await env.f.sql`update rooms set status='ready' where id=${env.roomId}`;
    const roomReady = await env.standing();
    await env.f
      .sql`update room_invitations set state='declined',ended_at=clock_timestamp()
      where id=${env.invitationId}`;
    const ended = await env.standing();
    assert({
      given:
        'a pending invitation, then its Room closed, then open again, then the invitation declined',
      should:
        'stand in the inbox and the email alike only while pending on an open Room',
      actual: { open, roomClosed, roomReady, ended },
      expected: {
        open: { inbox: true, email: 'room_invitation' },
        roomClosed: { inbox: false, email: 'cancel' },
        roomReady: { inbox: true, email: 'room_invitation' },
        ended: { inbox: false, email: 'cancel' },
      },
    });
  });
});

test('an invitation past its expiry is open to neither reader', async () => {
  await withInvitation(async (env) => {
    const [row] = await env.f
      .sql`select expires_at from room_invitations where id=${env.invitationId}`;
    const atExpiry = new Date(row!.expires_at as Date).toISOString();
    const inboxAtExpiry = (await env.standing(atExpiry)).inbox;
    await env.f.sql`update room_invitations
      set expires_at=clock_timestamp() - interval '1 second',
        created_at=clock_timestamp() - interval '1 hour'
      where id=${env.invitationId}`;
    assert({
      given:
        'a reader at the instant a pending invitation expires, and one after it',
      should: 'find it closed: it is open only before that instant',
      actual: { inboxAtExpiry, after: await env.standing() },
      expected: {
        inboxAtExpiry: false,
        after: { inbox: false, email: 'cancel' },
      },
    });
  });
});
