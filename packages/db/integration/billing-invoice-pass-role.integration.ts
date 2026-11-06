import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import {
  invoicePassOwnerSchema,
  paymentObservationComplete,
} from '@daisy/protocol/billing';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { fullRead } from './billing-payment-read.test-support';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';
import {
  retainCandidateInvoice,
  readCandidateObservation,
} from './billing-cleanup-witness.test-support';
import { claimTarget, passOf } from './billing-invoice-pass-role.test-support';
import { classifyAcrossMemberWait } from './billing-invoice-pass-wait.test-support';
requireTestServices(process.env);
setupRitewayBun();
const candidate = new URL(
  '../migrations/20261106110238_stripe_invoice_pass_authority/migration.sql',
  import.meta.url,
);
for (const lane of ['invoices', 'observations'] as const)
  test(
    `actual ${lane} enumeration guard preserves pending money and rejects missing/currently contradictory/expired authority`,
    async () =>
      withClosedPurchase(true, async (input) => {
        const { fixture, subject, cleanup } = input;
        const read = await fullRead(input);
        try {
          if (
            (await cleanup.recordPayment(subject.userId, read)) !== 'recorded'
          )
            throw Error('Missing original controlled payment');
          const rollback = Error('Owned invoice classification role rollback');
          try {
            await fixture.sql.begin(async (tx) => {
              await tx.unsafe(await Bun.file(candidate).text());
              await tx`set local role daisy_web`;
              await tx`select id from users where id=${subject.userId} for update`;
              const [job] =
                await tx`select id from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
              const jobId = job!.id as string,
                matrix = cleanupCandidate(tx, jobId);
              const retained = await retainCandidateInvoice(
                tx,
                jobId,
                read.invoiceId,
              );
              await tx`update billing_payment_observations set source=${JSON.stringify(read.source)}::text::jsonb where id=${retained.invoice.id}`;
              const witness = await matrix.readObservation(retained.invoice.id);
              const [payment] =
                await tx`select id,refund_action_id from billing_payment_observations where user_id=${subject.userId} and vendor_invoice_payment_id=${read.invoicePaymentId}`;
              const actual = await matrix.readObservation(payment!.id);
              const [actionBefore] =
                await tx`select to_jsonb(action) as value from billing_refund_actions action where id=${payment!.refund_action_id}`;
              const owner = invoicePassOwnerSchema.parse({
                mode: read.mode,
                customerId: read.customerId,
                invoiceId: read.invoiceId,
                source: read.source,
                userId: subject.userId,
                closedAt: witness.closedAt,
                period: read.evidence.payment.period,
              });
              const target = lane === 'invoices' ? read.invoiceId : witness.id;
              let active = await claimTarget(matrix, lane, target);
              await matrix.applyInvoice(
                { kind: 'start', passId: createId(), owner },
                witness,
              );
              active = await claimTarget(matrix, lane, target);
              await matrix.applyInvoice(
                {
                  kind: 'advance',
                  event: {
                    kind: 'retained',
                    beforeId: null,
                    read,
                    observation: actual,
                    more: false,
                  },
                },
                witness,
              );
              active = await claimTarget(matrix, lane, target);
              const beforeHead = await matrix.probe(() =>
                classify(tx, witness.id, read.invoicePaymentId),
              );
              const pass = passOf(active.work),
                at = await matrix.now();
              await matrix.applyInvoice(
                {
                  kind: 'advance',
                  event: {
                    kind: 'head',
                    receipt: {
                      kind: 'head',
                      passId: pass.id,
                      jobId,
                      claimId: active.claimId,
                      startedAt: active.state.claim!.claimedAt,
                      observedAt: at,
                      owner,
                      request: { invoiceId: read.invoiceId, limit: 20 },
                      hasMore: false,
                      reads: [read],
                    },
                    retained: [actual],
                  },
                },
                witness,
              );
              await tx`savepoint expiry_matrix`;
              active = await claimTarget(matrix, lane, target, 800);
              await tx`savepoint held_classification`;
              const waited = await classifyAcrossMemberWait({
                sql: fixture.sql,
                tx,
                paymentId: payment!.id,
                invoiceId: witness.id,
                state: coverage(read.invoicePaymentId),
                expiresAt: active.state.claim!.expiresAt,
              });
              await tx`rollback to savepoint held_classification`;
              await tx`release savepoint held_classification`;
              await tx`rollback to savepoint expiry_matrix`;
              await tx`release savepoint expiry_matrix`;
              active = await claimTarget(matrix, lane, target);
              const wrongCount = await matrix.probe(() =>
                classify(tx, witness.id, read.invoicePaymentId, 2),
              );
              const conflicting = await matrix.probe(async () => {
                await tx`update billing_payment_observations set state=${JSON.stringify({ kind: 'owed', reason: 'conflicting_evidence', evidence: { kind: 'verified', payment: read.evidence.payment } })}::text::jsonb where id=${payment!.id}`;
                await classify(tx, witness.id, read.invoicePaymentId);
              });
              await classify(tx, witness.id, read.invoicePaymentId);
              const resolved = await readCandidateObservation(
                tx,
                jobId,
                witness.id,
              );
              const paymentAfter = await matrix.readObservation(payment!.id);
              const [actionAfter] =
                await tx`select to_jsonb(action) as value from billing_refund_actions action where id=${payment!.refund_action_id}`;
              assert({
                given:
                  'current complete bounded HEAD and exact business identity with an independently pending original refund action',
                should:
                  'refuse stale/phase/count/conflict authority, sample time after a real member-lock wait, and resolve only enumeration without altering money',
                actual: [
                  beforeHead,
                  waited,
                  wrongCount,
                  conflicting,
                  resolved.state,
                  paymentAfter,
                  actionAfter,
                  paymentObservationComplete(paymentAfter),
                ],
                expected: [
                  '23514',
                  { code: '23514', waitObservedWhileLive: true },
                  '23514',
                  '23514',
                  coverage(read.invoicePaymentId),
                  actual,
                  actionBefore,
                  false,
                ],
              });
              await matrix.apply({
                kind: 'retained',
                claimId: active.claimId,
                work: active.work,
                observation: resolved,
              });
              const unchanged = await matrix.probe(() =>
                classify(tx, witness.id, read.invoicePaymentId),
              );
              assert({
                given:
                  'unchanged historical resolved coverage after its claim was consumed',
                should:
                  'remain writable without inventing fresh execution or settling its independently owed action',
                actual: [
                  unchanged,
                  (await matrix.read()).billing_cleanup.claim,
                ],
                expected: ['accepted', null],
              });
              throw rollback;
            });
          } catch (error) {
            if (error !== rollback) throw error;
          }
        } finally {
          await fixture.sql`delete from billing_payment_observations where user_id=${subject.userId}`;
          await fixture.sql`delete from billing_refund_actions where user_id=${subject.userId}`;
        }
      }),
    20_000,
  ); // <=14 mandatory one-second progression intervals plus the controlled paid-second/member wait.
function coverage(lastPaymentId: string, paymentCount = 1) {
  return {
    kind: 'resolved',
    basis: 'enumeration_retained',
    paymentCount,
    lastPaymentId,
  };
}
function classify(
  tx: import('bun').TransactionSQL,
  id: string,
  last: string,
  count = 1,
) {
  return tx`update billing_payment_observations set state=${JSON.stringify(coverage(last, count))}::text::jsonb,observed_at=date_trunc('milliseconds',clock_timestamp()) where id=${id}`;
}
