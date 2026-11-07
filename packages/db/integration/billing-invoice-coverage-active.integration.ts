import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { startCleanup } from '@daisy/protocol/billing';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { seedInvoicePassPredecessor } from './billing-invoice-pass-predecessor.test-support';
import { retainCandidateObservation } from './billing-cleanup-witness.test-support';
import {
  claimedV2,
  pageV2,
  invoiceStepV2,
} from './billing-invoice-coverage-v2-producer.test-support';
import { sqlStateOf } from './constraint-helpers';
requireTestServices(process.env);
setupRitewayBun();
const authority = new URL(
  './fixtures/billing-private-113/20261106110238_stripe_invoice_pass_authority.sql',
  import.meta.url,
);
const previous = new URL(
  './fixtures/billing-private-113/20261106023226_stripe_cleanup_failure_classification.sql',
  import.meta.url,
);
const forward = new URL(
  './fixtures/billing-private-113/20261106223739_stripe_invoice_coverage_repair.sql',
  import.meta.url,
);

for (const cohort of [
  'pending-null',
  'deleting',
  'active-invoice-pass',
] as const)
  test(
    `actual112 ${cohort} retires authority without losing queue or selected facts`,
    async () =>
      withClosedPurchase(true, async ({ fixture, subject, jobId }) => {
        const rollback = Error('Owned active112 correction rollback');
        try {
          await fixture.sql.begin(async (tx) => {
            await tx`drop index if exists public.privacy_jobs_pending_vendor_due_idx`;
            const source = await Bun.file(authority).text();
            // Keep a genuine current112 NULL until its own first claim, rather than111-to112 migration initialization.
            await tx.unsafe(
              source.slice(
                source.lastIndexOf(
                  'CREATE OR REPLACE FUNCTION public.daisy_guard_stripe_cleanup()',
                ),
              ),
            );
            if (cohort === 'active-invoice-pass') {
              await tx.unsafe(await Bun.file(previous).text());
              await tx`set local role daisy_web`;
              await tx`select id from users where id=${subject.userId} for update`;
              await seedInvoicePassPredecessor(tx, jobId, 'selected-invoices');
              await tx`reset role`;
              await tx.unsafe(source);
            }
            await tx`set local role daisy_web`;
            await tx`select id from users where id=${subject.userId} for update`;
            if (cohort === 'deleting')
              for (let n = 0; n < 5; n++) await pageV2(tx, jobId);
            if (cohort === 'active-invoice-pass') {
              const [selected] =
                await tx`select billing_cleanup from privacy_jobs where id=${jobId}`;
              const invoiceId = selected!.billing_cleanup.scans.invoices.id;
              const [row] =
                await tx`select id from billing_payment_observations where user_id=${subject.userId} and kind='invoice' and vendor_invoice_id=${invoiceId}`;
              const witness = await retainCandidateObservation(
                tx,
                jobId,
                row!.id,
              );
              await invoiceStepV2(
                tx,
                jobId,
                {
                  kind: 'start',
                  passId: createId(),
                  owner: {
                    userId: subject.userId,
                    mode: witness.mode,
                    customerId: witness.customerId,
                    invoiceId: witness.invoiceId,
                    closedAt: witness.closedAt,
                    source: witness.source,
                    period: null,
                  },
                },
                witness,
              );
              await claimedV2(tx, jobId);
            }
            const [before] =
              await tx`select to_jsonb(job) as value from privacy_jobs job where id=${jobId}`;
            const facts =
              await tx`select to_jsonb(row) as value from billing_payment_observations row where user_id=${subject.userId} order by id`;
            await tx`reset role`;
            const sql = await Bun.file(forward).text();
            await tx.unsafe(sql);
            const [after] =
              await tx`select to_jsonb(job) as value from privacy_jobs job where id=${jobId}`;
            const afterFacts =
              await tx`select to_jsonb(row) as value from billing_payment_observations row where user_id=${subject.userId} order by id`;
            const expected =
              cohort === 'active-invoice-pass'
                ? {
                    ...before!.value.billing_cleanup,
                    version: 3,
                    claim: null,
                    scans: {
                      ...before!.value.billing_cleanup.scans,
                      invoices: {
                        ...before!.value.billing_cleanup.scans.invoices,
                        detail: { kind: 'invoice-payments', pass: null },
                      },
                    },
                  }
                : startCleanup(
                    jobId,
                    cohort === 'pending-null'
                      ? new Date(before!.value.retry_at).toISOString()
                      : before!.value.billing_cleanup.retryAt,
                  );
            // Both selected lanes keep every original identity/remainder; selected observation detail is resource here.
            assert({
              given: `actual112 ${cohort} admitted by its original guard with controlled producer inputs`,
              should:
                'retire the old current claim/pass or initialize genuine NULL/deleting discovery while preserving every queue field and retained fact',
              actual: [
                cohort !== 'active-invoice-pass' ||
                  (before!.value.billing_cleanup.version === 2 &&
                    before!.value.billing_cleanup.claim !== null &&
                    before!.value.billing_cleanup.scans.invoices.detail.pass !==
                      null),
                before!.value.billing_cleanup?.kind ?? null,
                after!.value,
                afterFacts,
              ],
              expected: [
                true,
                cohort === 'pending-null'
                  ? null
                  : cohort === 'deleting'
                    ? 'deleting'
                    : 'scanning',
                { ...before!.value, billing_cleanup: expected },
                facts,
              ],
            });
            await tx`set local role daisy_web`;
            await tx`savepoint obsolete_active`;
            const stale = await sqlStateOf(
              () =>
                tx`update privacy_jobs set billing_cleanup=${JSON.stringify(before!.value.billing_cleanup)}::text::jsonb where id=${jobId}`,
            );
            await tx`rollback to savepoint obsolete_active`;
            await tx`release savepoint obsolete_active`;
            assert({
              given: 'the exact retired current112 wire reply',
              should: 'refuse it under the final strict authority guard',
              actual: stale,
              expected: '23514',
            });
            throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
      }),
    20_000,
  );
