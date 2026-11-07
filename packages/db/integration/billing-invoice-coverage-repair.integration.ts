import {
  installHistoricalInvoiceObservationProducer,
  seedHistoricalInvoiceFacts,
} from './billing-invoice-historical-facts.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { cleanupWork } from '@daisy/protocol/billing';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { seedCompletedInvoicePredecessor } from './billing-invoice-pass-predecessor.test-support';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';
import { sqlStateOf } from './constraint-helpers';
requireTestServices(process.env);
setupRitewayBun();
const previous = new URL(
  './fixtures/billing-private-113/20261106023226_stripe_cleanup_failure_classification.sql',
  import.meta.url,
);
const upgrade = new URL(
  './fixtures/billing-private-113/20261106110238_stripe_invoice_pass_authority.sql',
  import.meta.url,
);

// Both the predecessor trajectory and subsequent refund head use actual one-second progress intervals.
test(
  'pending predecessor enumeration cannot authorize deletion after its remaining refund head exhausts',
  async () =>
    withClosedPurchase(true, async ({ fixture, subject, session, jobId }) => {
      const rollback = Error('Owned pending enumeration repair rollback');
      try {
        await fixture.sql.begin(async (tx) => {
          // Restore the exact112 predecessor index inventory inside this owned rollback fixture.
          await tx`drop index if exists public.privacy_jobs_pending_vendor_due_idx`;
          await tx.unsafe(await Bun.file(previous).text());
          await installHistoricalInvoiceObservationProducer(tx);
          await tx`set local role daisy_web`;
          await tx`select id from users where id=${subject.userId} for update`;
          const invoiceId = `in_${createId()}`,
            paymentId = `inpay_${createId()}`,
            witnessId = createId(),
            memberId = createId();
          const source = await seedHistoricalInvoiceFacts(tx, {
            userId: subject.userId,
            customerId: session.customerId,
            subscriptionId: session.subscriptionId,
            invoiceId,
            paymentId,
            witnessId,
            memberId,
          });
          const ids = [memberId, witnessId].sort();
          await seedCompletedInvoicePredecessor(tx, jobId, invoiceId, ids);
          const memberBefore = (
            await tx`select to_jsonb(row) as value from billing_payment_observations row where id=${memberId}`
          )[0]!.value;
          await tx`reset role`;
          await tx.unsafe(await Bun.file(upgrade).text());
          const [old] =
            await tx`select billing_cleanup from privacy_jobs where id=${jobId}`;
          const forward =
            process.env.BILLING_COVERAGE_FORWARD_SQL ??
            new URL(
              './fixtures/billing-private-113/20261106223739_stripe_invoice_coverage_repair.sql',
              import.meta.url,
            ).pathname;
          if (forward !== 'predecessor')
            await tx.unsafe(await Bun.file(forward).text());
          await tx`set local role daisy_web`;
          const [current] =
            await tx`select billing_cleanup from privacy_jobs where id=${jobId}`;
          await tx`savepoint obsolete_completion`;
          const stale = await sqlStateOf(async () => {
            await tx`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.005) from privacy_jobs where id=${jobId}`;
            const [sample] = await tx`select clock_timestamp() as at`;
            const at = sample!.at.toISOString();
            const claimed = {
              ...old!.billing_cleanup,
              claim: {
                id: createId(),
                claimedAt: at,
                expiresAt: new Date(Date.parse(at) + 30000).toISOString(),
              },
            };
            await tx`update privacy_jobs set billing_cleanup=${JSON.stringify(claimed)}::text::jsonb where id=${jobId}`;
            const due = new Date(Date.parse(at) + 1000).toISOString();
            await tx`update privacy_jobs set billing_cleanup=${JSON.stringify({ version: 2, kind: 'deleting', jobId, retryAt: due, claim: null })}::text::jsonb,retry_at=${due}::timestamptz where id=${jobId}`;
          });
          await tx`rollback to savepoint obsolete_completion`;
          await tx`release savepoint obsolete_completion`;
          const [witness] =
            await tx`select source,state,closed_at,created_at from billing_payment_observations where id=${witnessId}`;
          const memberAfter = (
            await tx`select to_jsonb(row) as value from billing_payment_observations row where id=${memberId}`
          )[0]!.value;
          assert({
            given:
              'actual legal111 consumed enumeration,112 conversion and an unchanged settled payment with only refund HEAD remaining',
            should:
              'retire predecessor completion authority and retain fresh invoice obligations without changing payment knowledge or frozen source',
            actual: [
              current!.billing_cleanup.version,
              current!.billing_cleanup.scans.invoices,
              current!.billing_cleanup.scans.observations,
              stale,
              witness!.source,
              witness!.state,
              memberAfter,
            ],
            expected: [
              3,
              { kind: 'page', afterId: null },
              { kind: 'page', afterId: null },
              '23514',
              source,
              { kind: 'owed', reason: 'enumeration_unavailable' },
              memberBefore,
            ],
          });
          // The predecessor negative control has already failed its authority assertion; avoid a secondary parser error.
          if (current!.billing_cleanup.version !== 3) throw rollback;
          const matrix = cleanupCandidate(tx, jobId),
            claim = await matrix.claim();
          const progressed = await matrix.apply({
            kind: 'page',
            claimId: matrix.token(claim),
            work: cleanupWork(claim)!,
            ids: [],
            more: false,
          });
          assert({
            given:
              'the new exact current refund HEAD completes while fresh invoice enumeration remains owed',
            should: 'keep discovery pending instead of entering deleting',
            actual: progressed.kind,
            expected: 'scanning',
          });
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
    }),
  30000,
);
