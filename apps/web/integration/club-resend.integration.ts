import { hostWaits } from '@daisy/worker/host';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';

setupRitewayBun();

import { withClub } from './club-manager.test-support';

// Moved from db/club-seats.integration.ts: the same behavioral assertions now use the actual application decision.
test('invitation mail is throttled, and a lapsed plan gives no seats', async () => {
  await withClub(async ({ sql, owner, organizationId, paid, seats, post }) => {
    const invited = await post({
      kind: 'invite',
      email: 'throttle@club.example',
    });
    assert({
      given: 'the manager route with another existing seat command',
      should: 'keep invitation creation and durable mail unchanged',
      actual: [invited.status, await invited.json()],
      expected: [200, { kind: 'changed' }],
    });
    const [invitation] =
      await sql`select id from club_seat_invitations where organization_id=${organizationId}`;
    const invitationId = invitation!.id as string;
    const resend = async () => {
      const response = await post({ kind: 'resend', invitationId });
      if (response.status !== 200)
        throw new Error(`Resend route status ${response.status}`);
      return response.json();
    };
    const tooSoon = await resend();
    await sql`update mail_intents set state='sent', completed_at=now(), created_at=now() - interval '2 hours' where club_seat_invitation_id=${invitationId}`;
    const allowed = await resend();
    await sql`update mail_intents set state='sent', completed_at=now(), created_at=now() - interval '2 hours' where club_seat_invitation_id=${invitationId}`;
    for (let sent = 2; sent < 5; sent += 1)
      await sql`insert into mail_intents(id,purpose,club_seat_invitation_id,dedupe_key,state,completed_at,created_at,next_attempt_at) values(${createId()},'club-seat-invitation',${invitationId},${`club-seat-invitation:${organizationId}:${invitationId}:${createId()}`},'sent',now(),now()-interval '2 hours',now())`;
    const capped = await resend();
    assert({
      given:
        'a resend right after inviting, one an hour later, and one after five sends',
      should: 'refuse too soon, allow, then refuse at the cap',
      actual: [tooSoon, allowed, capped],
      expected: [
        { kind: 'refused', reason: 'resend-too-soon' },
        { kind: 'changed' },
        { kind: 'refused', reason: 'invitation-mail-limit' },
      ],
    });
    await sql`update billing_subscriptions set evidence=${{ ...paid, lifecycle: 'canceled' }} where organization_id=${organizationId}`;
    assert({
      given:
        'a cancelled plan, then an invitation, an assignment, a seat change and a resend',
      should: 'refuse each with no active plan, writing nothing',
      actual: [
        await seats.command(owner, organizationId, {
          kind: 'invite',
          email: 'late@club.example',
        }),
        await seats.command(owner, organizationId, {
          kind: 'assign',
          userId: owner.userId,
        }),
        await seats.command(owner, organizationId, {
          kind: 'prepare-seat-count',
          seatCount: 1,
          release: { seats: [], invitations: [invitationId] },
        }),
        await resend(),
        (
          await sql`select count(*)::int as n from club_seat_invitations where organization_id=${organizationId}`
        )[0]!.n,
      ],
      expected: [
        { kind: 'refused', reason: 'no-active-plan' },
        { kind: 'refused', reason: 'no-active-plan' },
        { kind: 'refused', reason: 'no-active-plan' },
        { kind: 'refused', reason: 'no-active-plan' },
        1,
      ],
    });
  });
});

test('concurrent resend decisions wait for the Club fence and enqueue only once', async () => {
  await withClub(async ({ sql, owner, organizationId, seats }) => {
    await seats.command(owner, organizationId, {
      kind: 'invite',
      email: 'race@club.example',
    });
    const [invitation] =
      await sql`select id from club_seat_invitations where organization_id=${organizationId}`;
    const invitationId = invitation!.id as string;
    await sql`update mail_intents set state='sent', completed_at=now(), created_at=now()-interval '2 hours' where club_seat_invitation_id=${invitationId}`;
    const release = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<number>();
    const holder = sql.begin(async (tx) => {
      await tx`select id from organizations where id=${organizationId} for update`;
      ready.resolve((await tx`select pg_backend_pid() as pid`)[0]!.pid);
      await release.promise;
    });
    void holder.catch(ready.reject);
    let requests: Promise<unknown[]> | undefined;
    try {
      const pid = await ready.promise;
      requests = Promise.all(
        [0, 1].map(() =>
          seats.command(owner, organizationId, {
            kind: 'resend',
            invitationId,
          }),
        ),
      );
      const waited = await finishedOrBlockedBehind(requests, sql, pid, {
        waits: hostWaits,
        deadlineMs: 1500,
      });
      release.resolve();
      await holder;
      const answers = await requests;
      assert({
        given:
          'two eligible resends blocked behind the existing Club row fence',
        should:
          'observe the first queue write before deciding the second, with only one new durable mail',
        actual: [
          waited,
          answers.filter((a) => (a as { kind: string }).kind === 'changed')
            .length,
          answers.filter(
            (a) => (a as { reason?: string }).reason === 'resend-too-soon',
          ).length,
          (
            await sql`select count(*)::int as n from mail_intents where club_seat_invitation_id=${invitationId}`
          )[0]!.n,
        ],
        expected: ['blocked', 1, 1, 2],
      });
    } finally {
      release.resolve();
      await holder;
      await requests;
    }
  });
});

test('resend refusal and failed decision write no mail, and its count reader cannot escape the fence', async () => {
  await withClub(async ({ sql, owner, organizationId, store, seats }) => {
    await seats.command(owner, organizationId, {
      kind: 'invite',
      email: 'failure@club.example',
    });
    const [invitation] =
      await sql`select id from club_seat_invitations where organization_id=${organizationId}`;
    const invitationId = invitation!.id as string;
    let later: (() => Promise<unknown>) | null = null;
    const failure = createAppError(
      'INVARIANT',
      'Controlled application decision failure',
    );
    const caught = await store
      .resend(owner, organizationId, invitationId, async (_facts, mail) => {
        later = mail;
        await mail();
        throw failure;
      })
      .catch((error: unknown) => error);
    let escaped = false;
    try {
      if (later) await (later as () => Promise<unknown>)();
    } catch {
      escaped = true;
    }
    const missing = await seats.command(owner, organizationId, {
      kind: 'resend',
      invitationId: createId(),
    });
    await sql`update club_seat_invitations set created_at=now()-interval '1 day', expires_at=now()-interval '1 hour' where id=${invitationId}`;
    const expired = await seats.command(owner, organizationId, {
      kind: 'resend',
      invitationId,
    });
    assert({
      given:
        'a failed application decision, an escaped facts reader, and missing/expired invitations',
      should: 'leave the durable queue unchanged and preserve refusals',
      actual: [
        caught === failure,
        escaped,
        missing,
        expired,
        (
          await sql`select count(*)::int as n from mail_intents where club_seat_invitation_id=${invitationId}`
        )[0]!.n,
      ],
      expected: [
        true,
        true,
        { kind: 'refused', reason: 'invitation-not-found' },
        { kind: 'refused', reason: 'invitation-expired' },
        1,
      ],
    });
  });
});
