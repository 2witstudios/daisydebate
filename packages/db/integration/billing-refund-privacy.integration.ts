import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { exportPrivacySubject } from '../src/privacy';
import {
  withBillingRefunds,
  refundRooms,
} from './billing-refunds.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('a retained financial action routes a late verified event after ordinary customer deletion, without access resurrection or duplicate job churn', async () =>
  withBillingRefunds(
    async ({ fixture, refunds, userId, payment, vendorCustomerId, inbox }) => {
      await refunds.admit(userId, payment);
      await fixture.sql`delete from billing_customers where user_id=${userId}`;
      await fixture.sql`update privacy_jobs set status='succeeded',succeeded_at=clock_timestamp() where subject_ref=${userId}`;
      const [oldJob] =
        await fixture.sql`select id from privacy_jobs where subject_ref=${userId}`;
      const event = {
        eventId: `evt_${createId()}`,
        customerId: vendorCustomerId,
        mode: 'test' as const,
      };
      const first = await inbox(event);
      const [job] =
        await fixture.sql`select id,status from privacy_jobs where subject_ref=${userId}`;
      const repeated = await inbox(event);
      const [again] =
        await fixture.sql`select id,status from privacy_jobs where subject_ref=${userId}`;
      const [facts] = await fixture.sql`select
      (select count(*)::int from billing_customers where user_id=${userId}) as customers,
      (select count(*)::int from billing_subscriptions where user_id=${userId}) as subscriptions,
      (select count(*)::int from account_entitlement_grants where user_id=${userId}) as grants`;
      assert({
        given:
          'ordinary customer data is gone but a classified refund obligation remains',
        should:
          'route a new late event to the closed subject once and never restore access',
        actual: [
          first,
          job!.id !== oldJob!.id,
          job!.status,
          repeated,
          again,
          facts,
        ],
        expected: [
          'closed',
          true,
          'pending',
          'duplicate',
          job,
          { customers: 0, subscriptions: 0, grants: 0 },
        ],
      });
      const foreign = await inbox({
        ...event,
        eventId: `evt_${createId()}`,
        mode: 'live',
      });
      assert({
        given: 'the same vendor ID from a different mode',
        should: 'remain unlinked without borrowing the test action',
        actual: foreign,
        expected: 'pending',
      });
    },
  ));

test('subject export retains original financial facts but excludes claim/cursor and other accounts after customer deletion', async () =>
  withBillingRefunds(async (first) =>
    withBillingRefunds(async (other) => {
      const admitted = await first.refunds.admit(first.userId, first.payment);
      const otherAdmitted = await other.refunds.admit(
        other.userId,
        other.payment,
      );
      if (!('action' in admitted) || !('action' in otherAdmitted))
        throw Error('Refund fixture refused');
      const current = await first.refunds.claim(admitted.action.id);
      if (!current?.action.claim) throw Error('Missing private claim');
      await first.fixture
        .sql`delete from billing_customers where user_id=${first.userId}`;
      const exported = await exportPrivacySubject(
        drizzle({ client: first.fixture.sql }),
        { userId: first.userId, actorId: first.actorId },
        refundRooms,
      );
      const rows = exported.billing_refund_actions!;
      assert({
        given:
          'two closed subjects, an outstanding private claim and deleted ordinary customer mapping',
        should:
          'export only original subject financial evidence with no internal execution authority',
        actual: [
          rows.length,
          rows[0]?.id,
          rows[0]?.vendor_charge_id,
          rows[0]?.amount_minor,
          rows[0]?.period_starts_at,
          JSON.stringify(exported).includes(current.action.claim.id),
          JSON.stringify(exported).includes(otherAdmitted.action.id),
          'claim' in rows[0]!,
          'afterRefundId' in (rows[0]!.state as Record<string, unknown>),
        ],
        expected: [
          1,
          admitted.action.id,
          first.payment.chargeId,
          '1000',
          first.payment.period.startsAt,
          false,
          false,
          false,
          false,
        ],
      });
    }),
  ));
