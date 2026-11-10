import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createResendSender } from '../src/features/mail/resend-sender';
import { resendRequest } from '../src/features/mail/resend-capture.test-support';
import { createNotificationEmailDelivery } from '../src/features/notifications/email/delivery';
import { inviteToRoom } from '../src/features/room-invitations/operations';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

const APP = 'https://daisy.example.test';

/**
 * RIN-12's end-to-end proof (ADR 0124), on PostgreSQL through the composed
 * store and the production Resend sender with its HTTP call captured: a host
 * invites a judge and a debater, each is told in the app and by email, a
 * third member cannot take the held judge seat, and the invited judge can.
 */
test('a host invites a judge and a debater; the held judge seat waits for its coach', async () => {
  await withRoomRuntime(async (f) => {
    const judge = f.guest;
    const debater = await f.member();
    const stranger = f.outsider;
    const emailOf = (userId: string) => `${userId}@daisy.test`;
    for (const who of [judge, debater])
      await f.sql`update users set email=${emailOf(who.userId)} where id=${who.userId}`;
    const choice = await f.foundation();
    let view = (
      await f.create({
        selection: {
          kind: 'custom',
          definition: {
            ...choice.definition,
            seats: { ...choice.definition.seats, judge: 1 },
          },
          config: choice.preset.config,
          competitionType: 'casual',
        },
      })
    ).view;
    const deps = { store: f.store, nextId: createId };
    const invitations = [
      await inviteToRoom(deps, f.host, {
        roomId: view.id,
        username: `u-${judge.userId}`,
        seat: 'judge',
      }),
      await inviteToRoom(deps, f.host, {
        roomId: view.id,
        username: `u-${debater.userId}`,
        seat: 'debater',
      }),
    ];
    try {
      const inboxOf = async (userId: string) =>
        (
          await f.store.readNotifications({
            userId,
            unreadOnly: true,
            limit: 10,
            now: new Date().toISOString(),
          })
        ).rows.map((row) =>
          row.kind === 'room_invitation'
            ? { kind: row.kind, roomId: row.roomId, seat: row.seat }
            : { kind: row.kind },
        );
      const captured: NonNullable<ReturnType<typeof resendRequest>>[] = [];
      const sender = createResendSender({
        apiKey: 'test-key',
        from: 'Daisy <play@daisy.example.test>',
        ids: { next: createId },
        nowMs: () => Date.now(),
        fetch: async (input, init) => {
          const request = resendRequest(input, init);
          if (request) captured.push(request);
          return new Response(JSON.stringify({ id: createId() }), {
            status: 200,
          });
        },
      });
      await createNotificationEmailDelivery({
        store: f.store,
        deliver: async (message) => {
          await sender.send(message);
          return 'sent';
        },
        appUrl: APP,
        unsubscribeSubkey: 'd'.repeat(64),
        nextToken: () => createId() + createId(),
        now: () => new Date().toISOString(),
        failed: (error) => {
          throw error;
        },
      }).run(50);
      const mailTo = (userId: string) =>
        captured
          .filter((mail) => mail.to === emailOf(userId))
          .map((mail) => ({
            judge: mail.text.includes('judge'),
            room: mail.text.includes(`${APP}/rooms/${view.id}`),
            unsubscribe: mail.text.includes(`${APP}/unsubscribe?`),
          }));
      assert({
        given: 'a host inviting one member to judge and another to debate',
        should:
          'give each an unread inbox row and one email naming the Room, the seat and how to unsubscribe',
        actual: {
          judgeInbox: await inboxOf(judge.userId),
          debaterInbox: await inboxOf(debater.userId),
          judgeMail: mailTo(judge.userId),
          debaterMail: mailTo(debater.userId),
        },
        expected: {
          judgeInbox: [
            { kind: 'room_invitation', roomId: view.id, seat: 'judge' },
          ],
          debaterInbox: [
            { kind: 'room_invitation', roomId: view.id, seat: 'debater' },
          ],
          judgeMail: [{ judge: true, room: true, unsubscribe: true }],
          debaterMail: [{ judge: false, room: true, unsubscribe: true }],
        },
      });

      view = await f.operations.view(stranger, view.id);
      await assertRejects({
        given: 'a third member claiming the judge seat held for the invitee',
        should: 'refuse it as unavailable',
        actual: () =>
          f.command(stranger, view, {
            type: 'claim-seat',
            role: 'judge',
            slot: 0,
          }),
        code: 'CONFLICT',
      });

      view = await f.operations.view(judge, view.id);
      view = (
        await f.command(judge, view, {
          type: 'claim-seat',
          role: 'judge',
          slot: 0,
        })
      ).view;
      const [accepted] =
        await f.sql`select state from room_invitations where id=${invitations[0]!.invitationId}`;
      const [seated] =
        await f.sql`select actor_id from room_participants where room_id=${view.id} and role='judge'`;
      const [hold] =
        await f.sql`select count(*)::int as n from room_seat_holds where room_id=${view.id} and actor_id=${judge.actorId}`;
      assert({
        given: 'the invited judge taking the held seat',
        should:
          'seat them, accept the invitation, free the hold and clear their inbox row',
        actual: {
          judge: seated?.actor_id,
          state: accepted?.state,
          holds: hold?.n,
          inbox: await inboxOf(judge.userId),
        },
        expected: {
          judge: judge.actorId,
          state: 'accepted',
          holds: 0,
          inbox: [],
        },
      });
    } finally {
      await f.sql`delete from outbox where kind='user.notification-delivered'
        and topic in ${f.sql([judge, debater].map((who) => `user:${who.actorId}:inbox`))}`;
    }
  });
});
