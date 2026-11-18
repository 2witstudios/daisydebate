import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import {
  clubSeatGrants,
  subscriptionAccess,
  subscriptionGrants,
} from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import type { SubscriptionEvidence } from '@daisy/protocol/billing';
import { createBillingSynchronization } from '../src/billing-synchronization';
import { createBillingInbox } from '../src/billing-inbox';
import { createClubSeats, endOfUtcDay } from '../src/club-seat-commands';
import { createClubSeatReads } from '../src/club-seat-reads';
import { readEntitlementGrants } from '../src/entitlement-grants';
import { completeControlledBillingPurchase } from '../src/testing-billing-purchase';
import { withBillingPurchases, offer } from './billing-purchases.test-support';
import { flagCommand } from './flags.test-support';
import { rejectedBy, type Fixture } from './constraint-helpers';

setupRitewayBun();
requireTestServices(process.env);

type Run = Parameters<typeof createClubSeats>[0]['run'];
/** Reconciliation as the worker drives it: a webhook hint, a claim, an apply. */
type Sync = {
  readonly store: ReturnType<typeof createBillingSynchronization>;
  readonly hint: () => Promise<unknown>;
};
const day = 86_400_000;

async function person(fixture: Fixture, organizationId: string | null) {
  const userId = await fixture.user();
  const actorId = await fixture.actor(userId);
  const email = `${userId}@club.example`;
  await fixture.sql`update users set email=${email}, email_verified=true where id=${userId}`;
  if (organizationId)
    await fixture.sql`insert into memberships (organization_id, user_id, status, joined_at)
      values (${organizationId}, ${userId}, 'active', now())`;
  return { userId, actorId, email };
}

async function club(fixture: Fixture, ownerUserId: string) {
  const organizationId = createId();
  await fixture.sql`insert into organizations (id, kind, name, handle, owner_user_id)
    values (${organizationId}, 'school', 'Northside Debate', ${`club-${organizationId}`}, ${ownerUserId})`;
  await fixture.sql`insert into memberships (organization_id, user_id, status, joined_at)
    values (${organizationId}, ${ownerUserId}, 'active', now())`;
  return organizationId;
}

async function cleanup(fixture: Fixture, clubs: readonly string[]) {
  for (const organizationId of clubs) {
    await fixture.sql`delete from mail_intents where dedupe_key like ${`club-seat-invitation:${organizationId}:%`}`;
    await fixture.sql`delete from club_seat_invitations where organization_id=${organizationId}`;
    await fixture.sql`delete from club_seats where organization_id=${organizationId}`;
    await fixture.sql`delete from account_entitlement_grants where organization_id=${organizationId}`;
    await fixture.sql`delete from billing_purchases where organization_id=${organizationId}`;
    await fixture.sql`delete from billing_subscriptions where organization_id=${organizationId}`;
    await fixture.sql`delete from billing_customers where organization_id=${organizationId}`;
    await fixture.sql`delete from membership_periods where organization_id=${organizationId}`;
    await fixture.sql`delete from memberships where organization_id=${organizationId}`;
    await fixture.sql`delete from organizations where id=${organizationId}`;
  }
}

/** A club with a paid plan of `seats` seats, its sync store and its seat store. */
function withPaidClub(
  seats: number,
  work: (input: {
    readonly fixture: Fixture;
    readonly run: Run;
    readonly owner: { readonly userId: string; readonly actorId: string };
    readonly organizationId: string;
    readonly customerId: string;
    readonly paid: SubscriptionEvidence;
    readonly sync: Sync;
    readonly seatStore: ReturnType<typeof createClubSeats>;
    readonly reads: ReturnType<typeof createClubSeatReads>;
    readonly clubs: string[];
  }) => Promise<void>,
) {
  return withBillingPurchases(async (input) => {
    const { fixture, run, subject, purchases } = input;
    const organizationId = await club(fixture, subject.userId);
    const clubs = [organizationId];
    const vendorCustomerId = `cus_${createId()}`;
    try {
      await input.store.runFlagCommand(flagCommand(input.key, 0));
      await completeControlledBillingPurchase({
        purchases,
        subject: { ...subject, organizationId },
        offer: { ...offer, quantity: seats },
        session: {
          kind: 'complete',
          id: `cs_test_${createId()}`,
          customerId: vendorCustomerId,
          subscriptionId: `sub_${createId()}`,
        },
      });
      const [customer] =
        await fixture.sql`select id from billing_customers where organization_id=${organizationId}`;
      const [subscription] =
        await fixture.sql`select id from billing_subscriptions where organization_id=${organizationId} and current`;
      const [clock] = await fixture.sql`select clock_timestamp() as now`;
      const now = Date.parse((clock!.now as Date).toISOString());
      const paid: SubscriptionEvidence = {
        lifecycle: 'active',
        settlement: {
          kind: 'paid',
          invoiceId: `in_${createId()}`,
          period: {
            subscriptionId: subscription!.id as string,
            startsAt: new Date(now - day).toISOString(),
            endsAt: new Date(now + 29 * day).toISOString(),
          },
        },
      };
      await work({
        fixture,
        run,
        owner: subject,
        organizationId,
        customerId: customer!.id as string,
        paid,
        sync: {
          store: createBillingSynchronization({
            run,
            nextId: createId,
            grants: { account: subscriptionGrants, club: clubSeatGrants },
          }),
          hint: () =>
            createBillingInbox({ run, nextId: createId })({
              eventId: `evt_${createId()}`,
              customerId: vendorCustomerId,
              mode: 'test',
            }),
        },
        seatStore: createClubSeats({
          run,
          nextId: createId,
          grants: clubSeatGrants,
          planActive: (evidence, at) =>
            subscriptionAccess(evidence, at).kind !== 'none',
        }),
        reads: createClubSeatReads({ run }),
        clubs,
      });
    } finally {
      await fixture.sql`delete from billing_webhook_events where vendor_customer_id=${vendorCustomerId}`;
      await cleanup(fixture, clubs);
    }
  });
}

const terms = (seatCount: number) => ({
  renewalOff: false,
  amountMinor: 1000,
  seatCount,
});
const apply = async (
  sync: Sync,
  customerId: string,
  evidence: SubscriptionEvidence,
  seatCount: number,
) => {
  await sync.hint();
  const claim = await sync.store.claim(customerId);
  if (!claim) throw Error('expected a claim');
  return sync.store.apply(claim, evidence, terms(seatCount));
};
const seatGrants = (fixture: Fixture, userId: string) =>
  fixture.sql`select entitlement, organization_id, starts_at, expires_at
    from account_entitlement_grants where user_id=${userId} and source='organization_seat'
    order by entitlement` as Promise<
    { entitlement: string; organization_id: string; expires_at: Date }[]
  >;

test('a seat on an active plan grants Premium; reconciliation is idempotent', async () => {
  await withPaidClub(
    3,
    async ({
      fixture,
      owner,
      organizationId,
      customerId,
      paid,
      sync,
      run,
      seatStore,
    }) => {
      assert({
        given: 'the first verified payment of a 3-seat Club plan',
        should: 'apply it',
        actual: await apply(sync, customerId, paid, 3),
        expected: 'applied',
      });
      const member = await person(fixture, organizationId);
      assert({
        given: 'the manager assigning a seat to a club member',
        should: 'seat them',
        actual: await seatStore.command(owner, organizationId, {
          kind: 'assign',
          userId: member.userId,
        }),
        expected: { kind: 'changed' },
      });
      const granted = await seatGrants(fixture, member.userId);
      assert({
        given: 'a seat on a paid plan',
        should:
          'grant the five Premium entitlements from the club, bounded by the paid period',
        actual: [
          granted.length,
          granted.every((row) => row.organization_id === organizationId),
          granted.every(
            (row) =>
              row.expires_at.toISOString() ===
              (paid.settlement as { period: { endsAt: string } }).period.endsAt,
          ),
        ],
        expected: [5, true, true],
      });
      const read = await run((tx) => readEntitlementGrants(tx, member.userId));
      assert({
        given: 'the seat holder’s grants read back for authorization',
        should: 'parse every seat grant with its paying club',
        actual: read
          .filter((grant) => grant.source === 'organization_seat')
          .map((grant) => 'organizationId' in grant && grant.organizationId),
        expected: Array(5).fill(organizationId),
      });
      await apply(sync, customerId, paid, 3);
      assert({
        given: 'the same verified observation applied again',
        should: 'leave exactly the same grants',
        actual: (await seatGrants(fixture, member.userId)).length,
        expected: 5,
      });
    },
  );
});

test('seats used never pass the seat count, and one account holds one seat across clubs', async () => {
  await withPaidClub(
    2,
    async ({
      fixture,
      owner,
      organizationId,
      customerId,
      paid,
      sync,
      seatStore,
      clubs,
    }) => {
      await apply(sync, customerId, paid, 2);
      const member = await person(fixture, organizationId);
      await seatStore.command(owner, organizationId, {
        kind: 'assign',
        userId: member.userId,
      });
      assert({
        given:
          'one seat held and one invited on a 2-seat plan, then a third invitation',
        should: 'hold the second seat for the invitation and refuse the third',
        actual: [
          await seatStore.command(owner, organizationId, {
            kind: 'invite',
            email: 'Second@Club.Example',
          }),
          await seatStore.command(owner, organizationId, {
            kind: 'invite',
            email: 'third@club.example',
          }),
        ],
        expected: [
          { kind: 'changed' },
          { kind: 'refused', reason: 'no-free-seat' },
        ],
      });
      const [mail] =
        await fixture.sql`select count(*)::int as n from mail_intents where purpose='club-seat-invitation' and dedupe_key like ${`club-seat-invitation:${organizationId}:%`}`;
      assert({
        given: 'the accepted invitation',
        should: 'queue one invitation mail and store the address normalised',
        actual: [
          mail!.n,
          (
            await fixture.sql`select email from club_seat_invitations where organization_id=${organizationId}`
          ).map((row: { email: string }) => row.email),
        ],
        expected: [1, ['second@club.example']],
      });
      const other = await person(fixture, null);
      const otherClub = await club(fixture, other.userId);
      clubs.push(otherClub);
      await fixture.sql`insert into memberships (organization_id, user_id, status, joined_at)
        values (${otherClub}, ${member.userId}, 'active', now())`;
      // The other club's plan is active too: copy this club's verified plan row.
      const copied = createId();
      await fixture.sql`insert into billing_subscriptions
        select (jsonb_populate_record(null::billing_subscriptions, to_jsonb(s) || jsonb_build_object(
          'id', ${copied}::text, 'organization_id', ${otherClub}::text,
          'vendor_subscription_id', ${`sub_${createId()}`}::text,
          'evidence', jsonb_set(s.evidence, '{settlement,period,subscriptionId}', to_jsonb(${copied}::text))))).*
        from billing_subscriptions s where s.organization_id=${organizationId} and s.current`;
      assert({
        given: 'another club assigning a seat to someone already seated here',
        should: 'refuse: one seat per account',
        actual: await seatStore.command(other, otherClub, {
          kind: 'assign',
          userId: member.userId,
        }),
        expected: { kind: 'refused', reason: 'seated-elsewhere' },
      });
    },
  );
});

test('an invitation is accepted only by its verified address, and the seat brings Premium and membership', async () => {
  await withPaidClub(
    2,
    async ({
      fixture,
      owner,
      organizationId,
      customerId,
      paid,
      sync,
      seatStore,
      reads,
    }) => {
      await apply(sync, customerId, paid, 2);
      const invitee = await person(fixture, null);
      const stranger = await person(fixture, null);
      await seatStore.command(owner, organizationId, {
        kind: 'invite',
        email: invitee.email,
      });
      const [invitation] =
        await fixture.sql`select id from club_seat_invitations where organization_id=${organizationId}`;
      const invitationId = invitation!.id as string;
      assert({
        given: 'someone signed in with another address',
        should: 'not see or accept the invitation',
        actual: [
          await reads.invitation(stranger, organizationId, invitationId),
          await seatStore
            .answer(stranger, organizationId, invitationId, 'accept')
            .then(
              () => 'accepted',
              () => 'not found',
            ),
        ],
        expected: [null, 'not found'],
      });
      assert({
        given: 'the invited address accepting',
        should: 'seat them, make them an active member and grant Premium',
        actual: [
          await seatStore.answer(
            invitee,
            organizationId,
            invitationId,
            'accept',
          ),
          (
            await fixture.sql`select status from memberships where organization_id=${organizationId} and user_id=${invitee.userId}`
          )[0]?.status,
          (await seatGrants(fixture, invitee.userId)).length,
          await reads.seatOf(invitee),
          (await reads.invitation(invitee, organizationId, invitationId))
            ?.seatedHere,
        ],
        expected: [
          { kind: 'changed' },
          'active',
          5,
          { name: 'Northside Debate', manager: `u-${owner.userId}` },
          true,
        ],
      });
    },
  );
});

test('removing a seat ends its Premium at the end of that UTC day; cancellation and lapsed grace revoke', async () => {
  await withPaidClub(
    3,
    async ({
      fixture,
      owner,
      organizationId,
      customerId,
      paid,
      sync,
      seatStore,
    }) => {
      await apply(sync, customerId, paid, 3);
      const removed = await person(fixture, organizationId);
      const kept = await person(fixture, organizationId);
      for (const member of [removed, kept])
        await seatStore.command(owner, organizationId, {
          kind: 'assign',
          userId: member.userId,
        });
      await seatStore.command(owner, organizationId, {
        kind: 'remove',
        userId: removed.userId,
      });
      const [clock] = await fixture.sql`select now() as now`;
      const midnight = endOfUtcDay(clock!.now as Date).toISOString();
      const ending = await seatGrants(fixture, removed.userId);
      assert({
        given: 'a seat removed mid-period',
        should:
          'free the seat now and keep its Premium until the end of the UTC day',
        actual: [
          (
            await fixture.sql`select count(*)::int as n from club_seats where user_id=${removed.userId}`
          )[0]!.n,
          ending.length,
          ending.every((row) => row.expires_at.toISOString() === midnight),
        ],
        expected: [0, 5, true],
      });
      await apply(sync, customerId, paid, 3);
      assert({
        given: 'a later reconciliation',
        should:
          'not restore the removed seat’s Premium past the end of the day',
        actual: (await seatGrants(fixture, removed.userId)).every(
          (row) => row.expires_at.toISOString() === midnight,
        ),
        expected: true,
      });
      const period = (
        paid.settlement as Extract<
          SubscriptionEvidence['settlement'],
          { kind: 'paid' }
        >
      ).period;
      const graceOver: SubscriptionEvidence = {
        lifecycle: 'past_due',
        settlement: {
          kind: 'renewal_failed',
          invoiceId: `in_${createId()}`,
          period: {
            subscriptionId: period.subscriptionId,
            startsAt: new Date(
              Date.parse(period.startsAt) - 39 * day,
            ).toISOString(),
            endsAt: new Date(
              Date.parse(period.startsAt) - 9 * day,
            ).toISOString(),
          },
          previous: {
            invoiceId: `in_${createId()}`,
            period: {
              subscriptionId: period.subscriptionId,
              startsAt: new Date(
                Date.parse(period.startsAt) - 69 * day,
              ).toISOString(),
              endsAt: new Date(
                Date.parse(period.startsAt) - 39 * day,
              ).toISOString(),
            },
          },
        },
      };
      // Evidence never moves backwards: a fresh, lapsed plan proves the grace rule.
      await fixture.sql`update billing_subscriptions set evidence=${JSON.stringify(graceOver)}::text::jsonb
        where organization_id=${organizationId} and current`;
      await apply(sync, customerId, graceOver, 3);
      assert({
        given: 'past_due more than seven days after the failed renewal',
        should: 'leave the seat holder no current Premium',
        actual: (
          await fixture.sql`select count(*)::int as n from account_entitlement_grants
            where user_id=${kept.userId} and source='organization_seat' and expires_at > now()`
        )[0]!.n,
        expected: 0,
      });
      await fixture.sql`update billing_subscriptions set evidence=${JSON.stringify(paid)}::text::jsonb
        where organization_id=${organizationId} and current`;
      await apply(sync, customerId, paid, 3);
      assert({
        given: 'the plan paid again',
        should: 'grant the seat holder Premium again',
        actual: (await seatGrants(fixture, kept.userId)).length,
        expected: 5,
      });
      await apply(sync, customerId, { ...paid, lifecycle: 'canceled' }, 3);
      assert({
        given: 'the Club plan cancelled',
        should: 'revoke every seat holder’s Premium',
        actual: (await seatGrants(fixture, kept.userId)).length,
        expected: 0,
      });
    },
  );
});

test('lowering the seat count below seats used needs the released seats named', async () => {
  await withPaidClub(
    2,
    async ({
      fixture,
      owner,
      organizationId,
      customerId,
      paid,
      sync,
      seatStore,
    }) => {
      await apply(sync, customerId, paid, 2);
      const first = await person(fixture, organizationId);
      const second = await person(fixture, organizationId);
      for (const member of [first, second])
        await seatStore.command(owner, organizationId, {
          kind: 'assign',
          userId: member.userId,
        });
      const prepare = (seats: readonly string[]) =>
        seatStore.command(owner, organizationId, {
          kind: 'prepare-seat-count',
          seatCount: 1,
          release: { seats, invitations: [] },
        });
      const unnamed = await prepare([]);
      const named = await prepare([second.userId]);
      assert({
        given: 'a cut from 2 seats to 1 with both held',
        should:
          'refuse until one seat is named, then release it and hand back the Stripe plan',
        actual: [
          unnamed,
          named.kind,
          named.kind === 'seat-count-ready'
            ? [named.currentSeatCount, named.seatCount]
            : null,
          (
            await fixture.sql`select user_id from club_seats where organization_id=${organizationId}`
          ).map((row: { user_id: string }) => row.user_id),
        ],
        expected: [
          { kind: 'refused', reason: 'choose-released-seats' },
          'seat-count-ready',
          [2, 1],
          [first.userId],
        ],
      });
      await apply(sync, customerId, paid, 1);
      assert({
        given: 'the lowered seat count observed from Stripe',
        should: 'keep the remaining holder’s Premium',
        actual: (await seatGrants(fixture, first.userId)).length,
        expected: 5,
      });
    },
  );
});

test('only the club’s manager changes its seats', async () => {
  await withPaidClub(
    2,
    async ({ fixture, organizationId, customerId, paid, sync, seatStore }) => {
      await apply(sync, customerId, paid, 2);
      const member = await person(fixture, organizationId);
      assert({
        given: 'a member who does not manage the club',
        should: 'not find it',
        actual: await seatStore
          .command(member, organizationId, {
            kind: 'invite',
            email: 'x@club.example',
          })
          .then(
            () => 'changed',
            () => 'not found',
          ),
        expected: 'not found',
      });
    },
  );
});

test('a lapsed seat invitation is purged 30 days after it lapses, with its unsent mail cancelled', async () => {
  await withPaidClub(2, async ({ fixture, organizationId, owner }) => {
    const { mailIntentOperations } = await import('../src/mail-intents');
    const old = createId(),
      recent = createId();
    for (const [id, lapsedDaysAgo] of [
      [old, 31],
      [recent, 2],
    ] as const)
      await fixture.sql`insert into club_seat_invitations
        (id, organization_id, email, invited_by_user_id, created_at, expires_at)
        values (${id}, ${organizationId}, ${`${id}@club.example`}, ${owner.userId},
          now() - make_interval(days => ${lapsedDaysAgo + 14}), now() - make_interval(days => ${lapsedDaysAgo}))`;
    const mail = createId();
    await fixture.sql`insert into mail_intents (id, purpose, club_seat_invitation_id, dedupe_key, next_attempt_at)
      values (${mail}, 'club-seat-invitation', ${old}, ${`club-seat-invitation:${organizationId}:${old}:${mail}`}, now())`;
    const operations = mailIntentOperations({
      database: (await import('drizzle-orm/bun-sql/postgres')).drizzle({
        client: fixture.sql,
      }),
      eventSink: undefined,
    });
    const deleted = await operations.purgeLapsedClubSeatInvitations({
      before: new Date(Date.now() - 30 * day).toISOString(),
      limit: 500,
    });
    assert({
      given: 'one invitation lapsed 31 days ago and one 2 days ago',
      should: 'purge only the older, cancelling its queued mail first',
      actual: [
        deleted,
        (
          await fixture.sql`select id from club_seat_invitations where organization_id=${organizationId}`
        ).map((row: { id: string }) => row.id),
        (await fixture.sql`select state from mail_intents where id=${mail}`)[0]
          ?.state,
      ],
      expected: [1, [recent], 'cancelled'],
    });
  });
});

test('erasing an account gives up its seat and the invitations addressed to it', async () => {
  await withPaidClub(
    3,
    async ({
      fixture,
      owner,
      organizationId,
      customerId,
      paid,
      sync,
      seatStore,
    }) => {
      await apply(sync, customerId, paid, 3);
      const holder = await person(fixture, organizationId);
      await seatStore.command(owner, organizationId, {
        kind: 'assign',
        userId: holder.userId,
      });
      await seatStore.command(owner, organizationId, {
        kind: 'invite',
        email: holder.email,
      });
      const { clubSeatPrivacyAdopter } =
        await import('../src/club-seat-privacy');
      const { drizzle } = await import('drizzle-orm/bun-sql/postgres');
      const database = drizzle({ client: fixture.sql });
      const exported = await database.transaction((tx) =>
        clubSeatPrivacyAdopter.export(tx, holder),
      );
      await database.transaction((tx) =>
        clubSeatPrivacyAdopter.erase(tx, holder, {
          now: new Date().toISOString(),
        }),
      );
      assert({
        given:
          'a seat holder with an invitation to their address, exported then erased',
        should: 'export both, then leave neither',
        actual: [
          exported.club_seats?.length,
          exported.club_seat_invitations?.length,
          (
            await fixture.sql`select count(*)::int as n from club_seats where user_id=${holder.userId}`
          )[0]!.n,
          (
            await fixture.sql`select count(*)::int as n from club_seat_invitations where email=${holder.email}`
          )[0]!.n,
        ],
        expected: [1, 1, 0, 0],
      });
    },
  );
});

test('a billing row is owned by exactly one account or organisation', async () => {
  await withPaidClub(1, async ({ fixture, owner, organizationId }) => {
    const refused = rejectedBy;
    assert({
      given:
        'a club’s customer, subscription and purchase given an account too, or no owner at all',
      should: 'refuse each as a check violation (the one-owner checks)',
      actual: [
        await refused(
          () =>
            fixture.sql`update billing_customers set user_id=${owner.userId} where organization_id=${organizationId}`,
        ),
        await refused(
          () =>
            fixture.sql`update billing_subscriptions set organization_id=null where organization_id=${organizationId}`,
        ),
        await refused(
          () =>
            fixture.sql`update billing_purchases set user_id=${owner.userId} where organization_id=${organizationId}`,
        ),
      ],
      expected: ['23514', '23514', '23514'],
    });
  });
});

test('a former member who accepts a seat rejoins now, with one open membership period', async () => {
  await withPaidClub(
    2,
    async ({
      fixture,
      owner,
      organizationId,
      customerId,
      paid,
      sync,
      seatStore,
    }) => {
      await apply(sync, customerId, paid, 2);
      const former = await person(fixture, null);
      await fixture.sql`insert into memberships (organization_id, user_id, status, joined_at)
        values (${organizationId}, ${former.userId}, 'active', '2026-01-01T00:00:00Z')`;
      await fixture.sql`update memberships set status='ended', ended_at='2026-02-01T00:00:00Z', version=version+1
        where organization_id=${organizationId} and user_id=${former.userId}`;
      const [before] =
        await fixture.sql`select version from organizations where id=${organizationId}`;
      await seatStore.command(owner, organizationId, {
        kind: 'invite',
        email: former.email,
      });
      const [invitation] =
        await fixture.sql`select id from club_seat_invitations where organization_id=${organizationId}`;
      await seatStore.answer(
        former,
        organizationId,
        invitation!.id as string,
        'accept',
      );
      const [clock] = await fixture.sql`select now() as now`;
      const open = await fixture.sql`select joined_at from membership_periods
          where organization_id=${organizationId} and user_id=${former.userId} and ended_at is null`;
      const [after] =
        await fixture.sql`select version from organizations where id=${organizationId}`;
      assert({
        given: 'an ended member accepting a seat',
        should:
          'make them active with exactly one open period from acceptance, and advance the club version',
        actual: [
          open.length,
          Date.parse(
            String(new Date(open[0]?.joined_at as Date).toISOString()),
          ) > Date.parse('2026-11-01T00:00:00Z') &&
            Math.abs(
              (open[0]?.joined_at as Date).getTime() -
                (clock!.now as Date).getTime(),
            ) < 60_000,
          Number(after!.version) > Number(before!.version),
        ],
        expected: [1, true, true],
      });
    },
  );
});

test('invitation mail is throttled, and a lapsed plan gives no seats', async () => {
  await withPaidClub(
    2,
    async ({
      fixture,
      owner,
      organizationId,
      customerId,
      paid,
      sync,
      seatStore,
    }) => {
      await apply(sync, customerId, paid, 2);
      await seatStore.command(owner, organizationId, {
        kind: 'invite',
        email: 'throttle@club.example',
      });
      const [invitation] =
        await fixture.sql`select id from club_seat_invitations where organization_id=${organizationId}`;
      const invitationId = invitation!.id as string;
      const resend = () =>
        seatStore.command(owner, organizationId, {
          kind: 'resend',
          invitationId,
        });
      const tooSoon = await resend();
      await fixture.sql`update mail_intents set state='sent', completed_at=now(),
          created_at=now() - interval '2 hours'
        where club_seat_invitation_id=${invitationId}`;
      const allowed = await resend();
      await fixture.sql`update mail_intents set state='sent', completed_at=now(),
          created_at=now() - interval '2 hours'
        where club_seat_invitation_id=${invitationId}`;
      for (let sent = 2; sent < 5; sent += 1)
        await fixture.sql`insert into mail_intents
          (id, purpose, club_seat_invitation_id, dedupe_key, state, completed_at, created_at, next_attempt_at)
          values (${createId()}, 'club-seat-invitation', ${invitationId},
            ${`club-seat-invitation:${organizationId}:${invitationId}:${createId()}`}, 'sent', now(), now() - interval '2 hours', now())`;
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
      await apply(sync, customerId, { ...paid, lifecycle: 'canceled' }, 2);
      const member = await person(fixture, organizationId);
      assert({
        given:
          'a cancelled plan, then an invitation, an assignment and a seat change',
        should: 'refuse each with no active plan, writing nothing',
        actual: [
          await seatStore.command(owner, organizationId, {
            kind: 'invite',
            email: 'late@club.example',
          }),
          await seatStore.command(owner, organizationId, {
            kind: 'assign',
            userId: member.userId,
          }),
          await seatStore.command(owner, organizationId, {
            kind: 'prepare-seat-count',
            seatCount: 1,
            release: { seats: [], invitations: [invitationId] },
          }),
          (
            await fixture.sql`select count(*)::int as n from club_seat_invitations where organization_id=${organizationId}`
          )[0]!.n,
        ],
        expected: [
          { kind: 'refused', reason: 'no-active-plan' },
          { kind: 'refused', reason: 'no-active-plan' },
          { kind: 'refused', reason: 'no-active-plan' },
          1,
        ],
      });
    },
  );
});
