import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { causeChainMember } from '../src/capacity-refusal';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
requireTestServices(process.env);
setupRitewayBun();
import { fullRead } from './billing-payment-read.test-support';
import { refundIdempotencyKey } from '@daisy/protocol/billing';

test('concurrent verified payment identities retain one original-charge action and never duplicate money authority', async () =>
  withClosedPurchase(true, async (input) => {
    const { fixture, subject, cleanup } = input;
    const read = await fullRead(input),
      secondId = `inpay_${createId()}`;
    const second = {
      ...read,
      invoicePaymentId: secondId,
      evidence: {
        kind: 'verified',
        payment: { ...read.evidence.payment, invoicePaymentId: secondId },
      },
    };
    try {
      const result = await Promise.all([
        cleanup.recordPayment(subject.userId, read),
        cleanup.recordPayment(subject.userId, second),
      ]);
      const observations = await fixture.sql<
        {
          readonly refund_action_id: string | null;
          readonly state: { readonly kind: string };
          readonly source: unknown;
        }[]
      >`select id,refund_action_id,state,source from billing_payment_observations where user_id=${subject.userId} order by id`;
      const actions =
        await fixture.sql`select * from billing_refund_actions where user_id=${subject.userId}`;
      const replay = await cleanup.recordPayment(subject.userId, read);
      const afterActions =
        await fixture.sql`select * from billing_refund_actions where user_id=${subject.userId}`;
      const [closed] =
        await fixture.sql`select deleted_at from users where id=${subject.userId}`;
      assert({
        given:
          'two positively owned paid identities backed by the same original full-charge obligation',
        should:
          'retain both observations and exactly one stable ready action/key with original period, while replay remains unchanged',
        actual: [
          result,
          observations.length,
          observations.map((row) => row.refund_action_id),
          observations.map((row) => row.state.kind),
          observations.map((row) => row.source),
          actions.length,
          {
            id: actions[0]!.id,
            userId: actions[0]!.user_id,
            mode: actions[0]!.mode,
            customerId: actions[0]!.vendor_customer_id,
            invoiceId: actions[0]!.vendor_invoice_id,
            subscriptionId: actions[0]!.vendor_subscription_id,
            chargeId: actions[0]!.vendor_charge_id,
            amountMinor: Number(actions[0]!.amount_minor),
            currency: actions[0]!.currency,
            paidAtSeconds: Number(actions[0]!.paid_at_seconds),
            closedAt: actions[0]!.closed_at.toISOString(),
            period: {
              startsAt: actions[0]!.period_starts_at.toISOString(),
              endsAt: actions[0]!.period_ends_at.toISOString(),
            },
          },
          refundIdempotencyKey({ id: actions[0]!.id }),
          afterActions,
          actions[0]!.state,
          replay,
        ],
        expected: [
          ['recorded', 'recorded'],
          2,
          [actions[0]!.id, actions[0]!.id],
          ['refund-linked', 'refund-linked'],
          [read.source, read.source],
          1,
          {
            id: actions[0]!.id,
            userId: subject.userId,
            mode: read.mode,
            customerId: read.customerId,
            invoiceId: read.invoiceId,
            subscriptionId: read.source.vendorSubscriptionId,
            chargeId: read.evidence.payment.chargeId,
            amountMinor: read.evidence.payment.amountMinor,
            currency: read.evidence.payment.currency,
            paidAtSeconds: read.evidence.payment.paidAtSeconds,
            closedAt: closed!.deleted_at.toISOString(),
            period: read.evidence.payment.period,
          },
          `daisy-closure-refund:${actions[0]!.id}`,
          actions,
          { kind: 'ready' },
          'unchanged',
        ],
      });
    } finally {
      await fixture.sql`delete from billing_payment_observations where user_id=${subject.userId}`;
      await fixture.sql`delete from billing_refund_actions where user_id=${subject.userId}`;
    }
  }));

test('failure during money admission rolls back the verified observation, refund action and job rotation together', async () =>
  withClosedPurchase(true, async (input) => {
    const { fixture, subject, cleanup, jobId } = input;
    const read = await fullRead(input);
    await fixture.sql`create function daisy_test_payment_money_failure() returns trigger language plpgsql as $$ begin if not exists(select 1 from billing_payment_observations where user_id=new.user_id and kind='payment') then raise exception 'money failure preceded observed identity' using errcode='22000';end if;raise exception 'injected money admission failure after observation' using errcode='23514',constraint='daisy_test_payment_money_failure_after_observation';end $$`;
    await fixture.sql`create trigger daisy_test_payment_money_failure before insert on billing_refund_actions for each row execute function daisy_test_payment_money_failure()`;
    let failed = false;
    try {
      try {
        await cleanup.recordPayment(subject.userId, read);
      } catch (error) {
        failed =
          causeChainMember(
            (e) =>
              Object.getOwnPropertyDescriptor(e, 'constraint')?.value ===
              'daisy_test_payment_money_failure_after_observation',
            error,
          ) !== undefined;
      }
      const [counts] =
        await fixture.sql`select (select count(*)::int from billing_payment_observations where user_id=${subject.userId}) as observations,(select count(*)::int from billing_refund_actions where user_id=${subject.userId}) as actions`;
      const [job] =
        await fixture.sql`select id from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
      assert({
        given:
          'the verified observation is visible before a definite transactional action-admission fault',
        should:
          'rollback every financial/observation write and retain the exact original job',
        actual: [failed, counts, job!.id],
        expected: [true, { observations: 0, actions: 0 }, jobId],
      });
    } finally {
      await fixture.sql`drop trigger daisy_test_payment_money_failure on billing_refund_actions`;
      await fixture.sql`drop function daisy_test_payment_money_failure()`;
    }
  }));
