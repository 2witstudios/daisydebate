import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { eq } from 'drizzle-orm';
import {
  paymentObservationComplete,
  refundIdempotencyKey,
} from '@daisy/protocol/billing';
import { createDatabase } from '../src/index';
import { billingPaymentObservations } from '../src/schema/billing-payment-observations';
import { paymentObservationFromRow } from '../src/billing-payment-observation-record';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { fullRead } from './billing-payment-read.test-support';
requireTestServices(process.env);
setupRitewayBun();

for (const variant of ['verified', 'chronology'] as const) {
  test(`public ${variant} source contradiction makes prior complete original-linked payment owed and rearms once`, async () =>
    withClosedPurchase(true, async (input) => {
      const { fixture, pool, subject, cleanup, instanceId, renew } = input;
      const read = await fullRead(input);
      const database = createDatabase({
        url: process.env.TEST_DATABASE_URL!,
        client: pool,
        nextActorId: createId,
      });
      const refunds = database.billingRefunds(instanceId);
      const observationRows = () =>
        drizzle({ client: fixture.sql })
          .select()
          .from(billingPaymentObservations)
          .where(eq(billingPaymentObservations.userId, subject.userId));
      try {
        await cleanup.recordPayment(subject.userId, read);
        const [initial] = await observationRows();
        if (!initial?.refundActionId)
          throw Error('Missing original linked action');
        const claim = await refunds.claim(initial.refundActionId);
        if (!claim?.action.claim) throw Error('Missing original action claim');
        await refunds.record(initial.refundActionId, {
          kind: 'observe',
          claimId: claim.action.claim.id,
          refundId: `re_${createId()}`,
          status: 'succeeded',
        });
        const [original] = await observationRows();
        const completeAction = await refunds.claim(initial.refundActionId);
        if (!completeAction) throw Error('Missing known-success action');
        const action = completeAction.action;
        const [originalAction] =
          await fixture.sql`select * from billing_refund_actions where id=${initial.refundActionId}`;
        const [priorJob] =
          await fixture.sql`select id,status,attempts,retry_at,billing_cleanup from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        assert({
          given:
            'a positively retained owned payment and its original refund currently known succeeded',
          should:
            'start from complete payment knowledge, not an already-owed negative-only fixture',
          actual: paymentObservationComplete(
            paymentObservationFromRow(original!),
            action,
          ),
          expected: true,
        });
        const source = { ...read.source, priceId: 'price_conflicting' };
        const evidence =
          variant === 'verified'
            ? {
                kind: 'verified',
                payment: { ...read.evidence.payment, priceId: source.priceId },
              }
            : {
                kind: 'chronology',
                proof: {
                  mode: read.mode,
                  customerId: read.customerId,
                  invoiceId: read.invoiceId,
                  invoicePaymentId: read.invoicePaymentId,
                  vendorSubscriptionId: source.vendorSubscriptionId,
                  priceId: source.priceId,
                  status: 'paid',
                  paidAtSeconds: read.evidence.payment.paidAtSeconds,
                },
                facts: {
                  status: 'paid',
                  paidAtSeconds: read.evidence.payment.paidAtSeconds,
                  amountPaidMinor: null,
                  charge: { kind: 'unresolved' },
                  period: null,
                },
              };
        const incoming = { ...read, source, evidence };
        const foreign = {
          ...incoming,
          evidence: {
            kind: 'verified',
            payment: {
              ...read.evidence.payment,
              priceId: source.priceId,
              invoiceId: 'in_foreign',
            },
          },
        };
        const refused = await cleanup.recordPayment(subject.userId, foreign);
        const malformed = await cleanup.recordPayment(subject.userId, {
          ...incoming,
          source: null,
        });
        await fixture.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
        await assertRejects({
          given: 'the same payment read without a current service',
          should: 'refuse before mutation or job rearm',
          code: 'AUTHORIZATION',
          actual: () => cleanup.recordPayment(subject.userId, incoming),
        });
        await renew();
        const [before] = await observationRows();
        const [beforeJob] =
          await fixture.sql`select id,status,attempts,retry_at,billing_cleanup from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        assert({
          given:
            'foreign proof identity, malformed source or absent current authority',
          should:
            'preserve complete original knowledge, original job and all financial authority',
          actual: [refused, malformed, before, beforeJob],
          expected: ['refuse', 'refuse', original, priorJob],
        });
        const result = await cleanup.recordPayment(subject.userId, incoming);
        const [changed] = await observationRows();
        const [job] =
          await fixture.sql`select id,status,attempts,retry_at,billing_cleanup from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        const replay = await cleanup.recordPayment(subject.userId, incoming);
        const [after] = await observationRows();
        const [afterJob] =
          await fixture.sql`select id,status,attempts,retry_at,billing_cleanup from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        const [afterAction] =
          await fixture.sql`select * from billing_refund_actions where id=${initial.refundActionId}`;
        assert({
          given: `the exact owned payment with a recognized source conflict and internally matching ${variant} proof`,
          should:
            'persist sticky owed, original source/evidence/link/action/key, rearm once and leave replay byte-identical',
          actual: [
            result,
            changed!.id,
            changed!.source,
            changed!.refundActionId,
            changed!.state,
            paymentObservationComplete(
              paymentObservationFromRow(changed!),
              action,
            ),
            job!.id !== priorJob!.id,
            job!.status,
            replay,
            after,
            afterJob,
            afterAction,
            refundIdempotencyKey(action),
          ],
          expected: [
            'recorded',
            original!.id,
            original!.source,
            original!.refundActionId,
            {
              kind: 'owed',
              reason: 'conflicting_evidence',
              evidence: {
                kind: 'verified',
                payment:
                  original!.state.kind === 'refund-linked'
                    ? original!.state.payment
                    : null,
              },
            },
            false,
            true,
            'pending',
            'unchanged',
            changed,
            job,
            originalAction,
            `daisy-closure-refund:${action.id}`,
          ],
        });
      } finally {
        await fixture.sql`delete from billing_payment_observations where user_id=${subject.userId}`;
        await fixture.sql`delete from billing_refund_actions where user_id=${subject.userId}`;
      }
    }));
}
