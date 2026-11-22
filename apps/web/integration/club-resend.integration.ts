import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '@daisy/db';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { clubSeatGrants, subscriptionAccess } from '@daisy/auth/authorization';
import type { SubscriptionEvidence } from '@daisy/protocol/billing';
import { createAppError } from '@daisy/errors';
import { noopErrorReporter } from '@daisy/observability';
import { withSql, testDatabaseUrl } from './fixtures';
import { silentLogger } from '../src/server/test-loggers.test-support';
import {
  composeClubRoutes,
  type ClubRouteDependencies,
} from '../src/features/clubs/routes';
import { createClubSeatCommands } from '../src/features/clubs/invitation-resend';

setupRitewayBun();

/** Real fenced store and application policy, with only external route collaborators unused. */
async function withClub(
  work: (input: {
    sql: Parameters<Parameters<typeof withSql>[0]>[0];
    owner: { userId: string; actorId: string };
    organizationId: string;
    paid: SubscriptionEvidence;
    store: ReturnType<ReturnType<typeof createDatabase>['clubSeats']>;
    seats: ReturnType<typeof createClubSeatCommands>;
    post: (command: unknown) => Promise<Response>;
  }) => Promise<void>,
) {
  await withSql(async (sql) => {
    const database = createDatabase({
      url: testDatabaseUrl,
      nextActorId: createId,
    });
    const owner = { userId: createId(), actorId: createId() };
    const organizationId = createId();
    const subscriptionId = createId();
    const [clock] = await sql`select clock_timestamp() as now`;
    const now = (clock!.now as Date).getTime();
    const paid: SubscriptionEvidence = {
      lifecycle: 'active',
      settlement: {
        kind: 'paid',
        invoiceId: `in_${createId()}`,
        period: {
          subscriptionId,
          startsAt: new Date(now - 86400000).toISOString(),
          endsAt: new Date(now + 29 * 86400000).toISOString(),
        },
      },
    };
    const store = database.clubSeats(
      clubSeatGrants,
      (evidence, at) => subscriptionAccess(evidence, at).kind !== 'none',
    );
    const seats = createClubSeatCommands(store);
    const origin = 'https://daisy.example';
    const unused = async (): Promise<never> => {
      throw new Error('Unrelated Club route collaborator used');
    };
    const deps: ClubRouteDependencies = {
      boundary: {
        logger: silentLogger,
        reporter: noopErrorReporter,
        origin: () => origin,
        identify: async () => ({
          state: 'member',
          username: owner.userId,
          principal: { kind: 'user', ...owner },
        }),
        limiter: () => ({
          consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
        }),
      },
      configured: true,
      released: async () => true,
      seats,
      reads: database.clubSeatReads,
      billing: {
        checkout: unused,
        portal: unused,
        changeSeats: unused,
        invoices: unused,
        ownPremium: unused,
      },
      createClub: unused,
    };
    const routes = composeClubRoutes(deps);
    const post = (command: unknown) =>
      routes.seats.POST(
        new Request(`${origin}/api/clubs/${organizationId}/seats`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify(command),
        }),
      );
    try {
      await sql`insert into users(id,username,email_verified) values(${owner.userId},${owner.userId},true)`;
      await sql`insert into actors(id,kind,user_id) values(${owner.actorId},'human',${owner.userId})`;
      await sql`insert into organizations(id,kind,name,handle,owner_user_id) values(${organizationId},'school','Club resend proof',${organizationId},${owner.userId})`;
      await sql`insert into memberships(organization_id,user_id,status,joined_at) values(${organizationId},${owner.userId},'active',now())`;
      await sql`insert into billing_subscriptions(id,organization_id,vendor_subscription_id,evidence,current,seat_count,observed_at) values(${subscriptionId},${organizationId},${`sub_${createId()}`},${paid},true,2,now())`;
      await work({ sql, owner, organizationId, paid, store, seats, post });
    } finally {
      await database.close();
      await sql`delete from mail_intents where dedupe_key like ${`club-seat-invitation:${organizationId}:%`}`;
      await sql`delete from club_seat_invitations where organization_id=${organizationId}`;
      await sql`delete from club_seats where organization_id=${organizationId}`;
      await sql`delete from account_entitlement_grants where organization_id=${organizationId}`;
      await sql`delete from billing_subscriptions where organization_id=${organizationId}`;
      await sql`delete from memberships where organization_id=${organizationId}`;
      await sql`delete from organizations where id=${organizationId}`;
      await sql`delete from actors where id=${owner.actorId}`;
      await sql`delete from users where id=${owner.userId}`;
    }
  });
}

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
        now: Date.now,
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
