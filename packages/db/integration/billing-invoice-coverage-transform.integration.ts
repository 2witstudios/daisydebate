import { proveQueueIndex } from './billing-cleanup-queue.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { startCleanup, type CleanupState } from '@daisy/protocol/billing';
import { cleanupCandidate } from './billing-cleanup-candidate.test-support';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import {
  invoicePassCohorts,
  seedInvoicePassPredecessor,
} from './billing-invoice-pass-predecessor.test-support';
import { sqlStateOf } from './constraint-helpers';
requireTestServices(process.env);
setupRitewayBun();
const migration = new URL(
  '../migrations/20261106223739_stripe_invoice_coverage_repair/migration.sql',
  import.meta.url,
);
const predecessor = new URL(
  '../migrations/20261106023226_stripe_cleanup_failure_classification/migration.sql',
  import.meta.url,
);
const historicalNullProducer = new URL(
  '../migrations/20261106004019_stripe_cleanup_observation_completion/migration.sql',
  import.meta.url,
);

const authorityV2 = new URL(
  '../migrations/20261106110238_stripe_invoice_pass_authority/migration.sql',
  import.meta.url,
);

for (const cohort of invoicePassCohorts)
  test(
    `guarded112 from-${cohort} preserves identities and new v3 replay authority`,
    async () =>
      withClosedPurchase(true, async ({ fixture, subject, jobId }) => {
        const rollback = Error('Owned invoice coverage v3 rollback');
        try {
          await fixture.sql.begin(async (tx) => {
            await tx`drop index if exists public.privacy_jobs_pending_vendor_due_idx`;
            await tx.unsafe(await Bun.file(predecessor).text());
            // A succeeded NULL is a real older generic-delivery fact;111 correctly refuses manufacturing it.
            if (cohort === 'succeeded-null')
              await tx.unsafe(await Bun.file(historicalNullProducer).text());
            await tx`set local role daisy_web`;
            await tx`select id from users where id=${subject.userId} for update`;
            await seedInvoicePassPredecessor(tx, jobId, cohort);
            await tx`reset role`;
            if (cohort === 'succeeded-null')
              await tx.unsafe(await Bun.file(predecessor).text());
            await tx.unsafe(await Bun.file(authorityV2).text());
            const nonStripeId = createId();
            await tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
              insert into privacy_jobs(id,subject_ref,vendor,created_at,retry_at)
              select ${nonStripeId},${subject.userId},'posthog',at,at from sampled`;
            const [before] =
              await tx`select to_jsonb(job) as value from privacy_jobs job where id=${jobId}`;
            const [otherBefore] =
              await tx`select to_jsonb(job) as value from privacy_jobs job where id=${nonStripeId}`;
            const financeBefore = await finances(tx, subject.userId);
            const sql = await Bun.file(migration).text();
            await tx.unsafe(sql.split('--> statement-breakpoint')[1]!);
            await tx`set local role daisy_web`;
            const malformed = await probe(
              tx,
              () =>
                tx`update privacy_jobs set attempts=attempts+1 where id=${jobId}`,
            );
            const lost = structuredClone(expectedExecution(before!.value));
            if (
              lost?.kind === 'scanning' &&
              lost.scans.invoices.kind === 'selected'
            )
              lost.scans.invoices.rest = [];
            else if (lost?.kind === 'scanning')
              lost.turn =
                lost.turn === 'purchases' ? 'subscriptions' : 'purchases';
            else if (lost?.kind === 'acknowledged') lost.jobId = createId();
            const wrongTransform = await probe(
              tx,
              () =>
                tx`update privacy_jobs set billing_cleanup=${JSON.stringify(lost)}::text::jsonb where id=${jobId}`,
            );
            await tx`reset role`;
            await tx.unsafe(sql);
            const [after] =
              await tx`select to_jsonb(job) as value from privacy_jobs job where id=${jobId}`;
            const [otherAfter] =
              await tx`select to_jsonb(job) as value from privacy_jobs job where id=${nonStripeId}`;
            const financeAfter = await finances(tx, subject.userId);
            assert({
              given: `actual guarded112 derived from111 ${cohort} and non-Stripe routing`,
              should:
                'transform only exact pending execution while retaining every selected identity, remainder, queue field and financial fact',
              actual: [
                malformed,
                wrongTransform,
                after!.value,
                otherAfter,
                financeAfter,
              ],
              expected: [
                '23514',
                '23514',
                {
                  ...before!.value,
                  billing_cleanup: expectedExecution(before!.value),
                },
                otherBefore,
                financeBefore,
              ],
            });
            await tx`set local role daisy_web`;
            if (cohort === 'pending-null')
              await proveQueueIndex(tx, jobId, nonStripeId);
            let stale = 'not-applicable';
            if (before!.value.status === 'pending') {
              stale = await probe(
                tx,
                () =>
                  tx`update privacy_jobs set billing_cleanup=${JSON.stringify(before!.value.billing_cleanup)}::text::jsonb where id=${jobId}`,
              );
              await cleanupCandidate(tx, jobId).claim();
            }
            const [newAuthority] =
              await tx`select to_jsonb(job) as value from privacy_jobs job where id=${jobId}`;
            await tx`reset role`;
            await tx.unsafe(
              sql
                .split('--> statement-breakpoint')
                .slice(1)
                .join('--> statement-breakpoint'),
            );
            const [replayed] =
              await tx`select to_jsonb(job) as value from privacy_jobs job where id=${jobId}`;
            assert({
              given:
                'a retired predecessor reply and a new current v3 claim, or unchanged historical completion',
              should:
                'refuse old execution and preserve new authority on migration replay without financial relief',
              actual: [stale, replayed, await finances(tx, subject.userId)],
              expected: [
                before!.value.status === 'pending' ? '23514' : 'not-applicable',
                newAuthority,
                financeBefore,
              ],
            });
            throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
      }),
    15_000,
  );

// Test oracle for the specified strict112-to113 transformation; never a runtime parser.
type Scanning = Extract<CleanupState, { kind: 'scanning' }>;
type BeforeState =
  | (Omit<Scanning, 'version'> & { version: 2 })
  | (Omit<Extract<CleanupState, { kind: 'deleting' }>, 'version'> & {
      version: 2;
    })
  | Extract<CleanupState, { kind: 'acknowledged' }>;
function expectedExecution(row: {
  status: string;
  id: string;
  retry_at: string;
  billing_cleanup: BeforeState | null;
}) {
  const old = row.billing_cleanup;
  if (row.status !== 'pending' || old?.kind === 'acknowledged') return old;
  if (old === null)
    return startCleanup(row.id, new Date(row.retry_at).toISOString());
  if (old.kind === 'deleting') return startCleanup(row.id, old.retryAt);
  const reset = (frame: Scanning['scans'][keyof Scanning['scans']]) =>
    frame.kind === 'selected'
      ? {
          ...frame,
          detail:
            frame.detail.kind === 'invoice-payments'
              ? { kind: 'invoice-payments' as const, pass: null }
              : frame.detail,
        }
      : { kind: 'page' as const, afterId: null };
  const scans = {
    ...old.scans,
    invoices: reset(old.scans.invoices),
    observations: reset(old.scans.observations),
  };
  return {
    ...old,
    version: 3,
    claim: null,
    turn: scans[old.turn].kind === 'complete' ? 'invoices' : old.turn,
    scans,
  };
}

async function finances(tx: import('bun').TransactionSQL, userId: string) {
  return (
    await tx`select
 (select coalesce(jsonb_agg(to_jsonb(row) order by row.user_id),'[]'::jsonb) from billing_customers row where user_id=${userId}) as customers,
 (select coalesce(jsonb_agg(to_jsonb(row) order by row.id),'[]'::jsonb) from billing_purchases row where user_id=${userId}) as purchases,
 (select coalesce(jsonb_agg(to_jsonb(row) order by row.id),'[]'::jsonb) from billing_refund_actions row where user_id=${userId}) as refunds,
 (select coalesce(jsonb_agg(to_jsonb(row) order by row.id),'[]'::jsonb) from billing_payment_observations row where user_id=${userId}) as observations`
  )[0];
}
async function probe(
  tx: import('bun').TransactionSQL,
  attempt: () => Promise<unknown>,
) {
  await tx`savepoint invoice_pass_transform_probe`;
  const result = await sqlStateOf(attempt);
  await tx`rollback to savepoint invoice_pass_transform_probe`;
  await tx`release savepoint invoice_pass_transform_probe`;
  return result;
}
