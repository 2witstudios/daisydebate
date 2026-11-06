import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { retainCandidateInvoice } from './billing-cleanup-witness.test-support';
import { sqlStateOf } from './constraint-helpers';
requireTestServices(process.env);
setupRitewayBun();
const candidate = new URL(
  '../migrations/20261106110238_stripe_invoice_pass_authority/migration.sql',
  import.meta.url,
);

test('retained last payment alone cannot create or replace invoice enumeration coverage without a current pass', async () =>
  withClosedPurchase(true, async ({ fixture, subject, jobId }) => {
    const rollback = Error('Owned enumeration admission rollback');
    try {
      await fixture.sql.begin(async (tx) => {
        if (process.env.BILLING_INVOICE_PASS_TEST_CANDIDATE === 'installed')
          await tx.unsafe(await Bun.file(candidate).text());
        await tx`set local role daisy_web`;
        await tx`select id from users where id=${subject.userId} for update`;
        const invoiceId = `in_${createId()}`,
          paymentId = `inpay_${createId()}`;
        const retained = await retainCandidateInvoice(
          tx,
          jobId,
          invoiceId,
          paymentId,
        );
        // A distinct owned payment has no invoice witness yet: UNIQUE must not supply this refusal.
        if (
          !retained.payment ||
          retained.payment.kind !== 'payment' ||
          retained.payment.refundActionId !== null ||
          retained.payment.state.kind !== 'owed'
        )
          throw Error('Expected unresolved payment fixture');
        const newInvoiceId = `in_${createId()}`,
          newPaymentId = `inpay_${createId()}`;
        await tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
          insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,vendor_invoice_payment_id,kind,source,state,closed_at,created_at,observed_at)
          select ${createId()},user_id,mode,vendor_customer_id,${newInvoiceId},${newPaymentId},kind,source,state,closed_at,at,at
          from billing_payment_observations cross join sampled where id=${retained.payment.id}`;
        const before = (
          await tx`select to_jsonb(row) as value from billing_payment_observations row where user_id=${subject.userId} order by id`
        ).map((row: { value: unknown }) => row.value);
        const coverage = {
          kind: 'resolved',
          basis: 'enumeration_retained',
          paymentCount: 1,
          lastPaymentId: paymentId,
        };
        const update = await probe(
          tx,
          () =>
            tx`update billing_payment_observations set state=${JSON.stringify(coverage)}::text::jsonb,observed_at=date_trunc('milliseconds',clock_timestamp()) where id=${retained.invoice.id}`,
        );
        // Standalone positive payment retention is allowed; fresh invoice classification still needs authority.
        const insert = await probe(
          tx,
          () => tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
    insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,source,state,closed_at,created_at,observed_at)
    select ${createId()},${subject.userId},${retained.invoice.mode},${retained.invoice.customerId},${newInvoiceId},'invoice',${JSON.stringify(retained.invoice.source)}::text::jsonb,${JSON.stringify({ ...coverage, lastPaymentId: newPaymentId })}::text::jsonb,${retained.invoice.closedAt}::timestamptz,at,at from sampled`,
        );
        const after = (
          await tx`select to_jsonb(row) as value from billing_payment_observations row where user_id=${subject.userId} order by id`
        ).map((row: { value: unknown }) => row.value);
        assert({
          given:
            'actual daisy_web mutation with retained invoice/payment identities but no final current execution pass',
          should:
            'reject both coverage UPDATE and fresh resolved INSERT through intended23514 guards without altering financial knowledge',
          actual: [update, insert, after],
          expected: ['23514', '23514', before],
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }));
async function probe(
  tx: import('bun').TransactionSQL,
  attempt: () => Promise<unknown>,
) {
  await tx`savepoint invoice_classification_probe`;
  const result = await sqlStateOf(attempt);
  await tx`rollback to savepoint invoice_classification_probe`;
  await tx`release savepoint invoice_classification_probe`;
  return result;
}
