import { hostWaits } from '@daisy/worker/host';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import {
  finishedOrBlockedBehind,
  completeControlledBillingPurchase,
} from '@daisy/db/testing';
import { fixedClock } from '@daisy/clock';
import { createClubBilling } from '../src/features/billing/club-billing';
import { withClub } from './club-manager.test-support';

setupRitewayBun();
test('a Club manager session cannot commit success without apply', async () => {
  await withClub(async ({ sql, owner, organizationId, store, post }) => {
    const command = { kind: 'invite', email: 'session@example.test' } as const;
    const refused = await store
      .managerCommand(owner, organizationId, command, async (session) => {
        await session.load();
        return { kind: 'changed' };
      })
      .then(
        () => 'committed',
        (error: { code: string }) => error.code,
      );
    const [before] =
      await sql`select count(*)::int as n from club_seat_invitations where organization_id=${organizationId}`;
    const response = await post(command);
    assert({
      given:
        'a callback claiming success without applying, followed by the real manager route',
      should:
        'reject missing settlement without invitation effects, then permit a real application decision',
      actual: [refused, before!.n, response.status, await response.json()],
      expected: ['INVARIANT', 0, 200, { kind: 'changed' }],
    });
  });
});

test('Club manager apply rolls back seating, invitation mail and grants on failure and cannot escape', async () => {
  await withClub(async ({ sql, owner, organizationId, store, post }) => {
    await post({ kind: 'invite', email: 'rollback@example.test' });
    const escaped: {
      apply?: () => Promise<void>;
      mail?: () => Promise<unknown>;
    } = {};
    const errors: string[] = [];
    for (const mode of ['exception', 'refusal'] as const) {
      const outcome = await store
        .managerCommand(
          owner,
          organizationId,
          { kind: 'assign', userId: owner.userId },
          async (session) => {
            const loaded = await session.load();
            const after = {
              ...loaded.before,
              invitations: [],
              seats: [{ userId: owner.userId, assignedAt: loaded.now }],
            };
            escaped.apply = () => loaded.apply(after);
            escaped.mail = loaded.mail;
            await loaded.apply(after);
            if (mode === 'exception') throw createAppError('CONFLICT');
            return { kind: 'refused', reason: 'no-active-plan' };
          },
        )
        .then(
          () => 'committed',
          (error: { code: string }) => error.code,
        );
      errors.push(outcome);
    }
    await escaped.apply?.().catch((error: { code: string }) => {
      errors.push(error.code);
    });
    try {
      await escaped.mail?.();
    } catch (error) {
      errors.push((error as { code: string }).code);
    }
    const [effects] =
      await sql`select (select count(*)::int from club_seats where organization_id=${organizationId}) as seats,(select count(*)::int from club_seat_invitations where organization_id=${organizationId}) as invitations,(select count(*)::int from mail_intents where dedupe_key like ${`club-seat-invitation:${organizationId}:%`} and state='queued') as mail,(select count(*)::int from account_entitlement_grants where organization_id=${organizationId}) as grants`;
    assert({
      given:
        'post-apply exception or incompatible refused result and escaped capabilities',
      should:
        'roll back seats, invitation cancellation, mail cancellation and grant projection, then close capabilities',
      actual: [errors, effects],
      expected: [
        ['CONFLICT', 'INVARIANT', 'INVARIANT', 'INVARIANT'],
        { seats: 0, invitations: 1, mail: 1, grants: 0 },
      ],
    });
    const rejected: string[] = [];
    await store.managerCommand(
      owner,
      organizationId,
      { kind: 'assign', userId: owner.userId },
      async (session) => {
        const loaded = await session.load();
        const after = {
          ...loaded.before,
          seats: [{ userId: owner.userId, assignedAt: loaded.now }],
        };
        await loaded.apply(after);
        for (const repeat of [() => session.load(), () => loaded.apply(after)])
          await repeat().catch((error: { code: string }) => {
            rejected.push(error.code);
          });
        return { kind: 'changed' };
      },
    );
    assert({
      given: 'a completed manager application',
      should: 'reject a second load and second apply',
      actual: rejected,
      expected: ['INVARIANT', 'INVARIANT'],
    });
  });
});

test('manager decisions see plan changes after the Club fence and permit inactive cancellation and removal', async () => {
  await withClub(async ({ sql, owner, organizationId, paid, post }) => {
    await post({ kind: 'invite', email: 'inactive@example.test' });
    await post({ kind: 'assign', userId: owner.userId });
    const [invitation] =
      await sql`select id from club_seat_invitations where organization_id=${organizationId}`;
    let response: Promise<Response> | undefined;
    let waited = '';
    try {
      await sql.begin(async (tx) => {
        await tx`select id from organizations where id=${organizationId} for update`;
        const [holder] = await tx`select pg_backend_pid() as pid`;
        response = post({ kind: 'invite', email: 'fresh@example.test' });
        waited = await finishedOrBlockedBehind(response, sql, holder!.pid, {
          waits: hostWaits,
          deadlineMs: 1500,
        });
        await tx`update billing_subscriptions set evidence=${{ ...paid, lifecycle: 'canceled' }} where organization_id=${organizationId}`;
      });
      const answer = await response!;
      const cancelled = await post({
        kind: 'cancel',
        invitationId: invitation!.id,
      });
      const removed = await post({ kind: 'remove', userId: owner.userId });
      assert({
        given:
          'a manager command waiting while the paid plan becomes inactive, then capacity-freeing commands',
        should:
          'refuse from fresh plan facts but still allow cancellation and removal',
        actual: [
          waited,
          answer.status,
          await answer.json(),
          await cancelled.json(),
          await removed.json(),
        ],
        expected: [
          'blocked',
          200,
          { kind: 'refused', reason: 'no-active-plan' },
          { kind: 'changed' },
          { kind: 'changed' },
        ],
      });
    } finally {
      await response?.catch(() => undefined);
    }
  });
});

test('actual Billing seat preparation checks readiness before releases and commits releases before vendor work', async () => {
  await withClub(
    async ({ sql, database, owner, organizationId, paid, seats, post }) => {
      await post({ kind: 'invite', email: 'billing@example.test' });
      await post({ kind: 'assign', userId: owner.userId });
      const [invitation] =
        await sql`select id from club_seat_invitations where organization_id=${organizationId}`;
      const unused = async (): Promise<never> => {
        throw createAppError('INVARIANT');
      };
      let vendorSaw: unknown;
      const billing = createClubBilling({
        vendor: {
          mode: 'test',
          club: {
            seatPriceId: 'price_test',
            portalConfigurationId: 'bpc_test',
          },
          checkout: {
            create: unused,
            retrieve: unused,
            expire: unused,
            list: unused,
          },
          portal: unused,
          plan: {
            subscription: async () => {
              const [seen] =
                await sql`select (select count(*)::int from club_seat_invitations where organization_id=${organizationId}) as invitations,(select count(*)::int from mail_intents where dedupe_key like ${`club-seat-invitation:${organizationId}:%`} and state='cancelled') as cancelled`;
              vendorSaw = seen;
              throw createAppError('INFRASTRUCTURE');
            },
            updateSeats: unused,
            invoices: unused,
          },
        },
        clock: fixedClock('2026-11-22T12:00:00.000Z'),
        returnOrigin: 'https://daisy.example',
        nextId: createId,
        purchases: database.billingPurchases({
          purchase: () => true,
          manage: () => true,
          release: { keys: ['club-seats'], decide: () => true },
        }),
        member: database.billingMember({
          manage: () => true,
          purchase: () => true,
          granted: () => false,
        }),
        seats,
      });
      const release = { seats: [], invitations: [invitation!.id as string] };
      const notReady = await billing.changeSeats(
        owner,
        organizationId,
        1,
        release,
      );
      const [before] =
        await sql`select count(*)::int as n from club_seat_invitations where organization_id=${organizationId}`;
      // Match the working DB Club fixture: establish the customer through real purchase admission and mapping.
      await sql`delete from billing_subscriptions where organization_id=${organizationId}`;
      await completeControlledBillingPurchase({
        purchases: database.billingPurchases({
          purchase: () => true,
          manage: () => true,
          release: { keys: ['club-seats'], decide: () => true },
        }),
        subject: { ...owner, organizationId },
        offer: {
          mode: 'test',
          priceId: 'price_fixture',
          returnOrigin: 'https://daisy.example',
          quantity: 2,
        },
        session: {
          kind: 'complete',
          id: `cs_test_${createId()}`,
          customerId: `cus_${createId()}`,
          subscriptionId: `sub_${createId()}`,
        },
      });
      const [subscription] =
        await sql`select id from billing_subscriptions where organization_id=${organizationId} and current`;
      if (paid.settlement.kind !== 'paid') throw createAppError('INVARIANT');
      const evidence = {
        ...paid,
        settlement: {
          ...paid.settlement,
          period: {
            ...paid.settlement.period,
            subscriptionId: subscription!.id as string,
          },
        },
      };
      await sql`update billing_subscriptions set evidence=${evidence},seat_count=2 where organization_id=${organizationId} and current`;

      // The vendor boundary observes committed releases before its controlled read fails.
      const ready = await billing.changeSeats(
        owner,
        organizationId,
        1,
        release,
      );
      const [after] =
        await sql`select (select count(*)::int from club_seat_invitations where organization_id=${organizationId}) as invitations,(select count(*)::int from mail_intents where dedupe_key like ${`club-seat-invitation:${organizationId}:%`} and state='cancelled') as cancelled`;
      assert({
        given:
          'actual Billing changeSeats before and after a valid customer identity is available',
        should:
          'refuse readiness before any release, then commit the named release before vendor work and retain the existing released-plan-unchanged failure result',
        actual: [notReady, before!.n, ready, vendorSaw, after],
        expected: [
          { kind: 'refused', reason: 'no-active-plan' },
          1,
          { kind: 'released-plan-unchanged' },
          { invitations: 0, cancelled: 1 },
          { invitations: 0, cancelled: 1 },
        ],
      });
    },
  );
});
