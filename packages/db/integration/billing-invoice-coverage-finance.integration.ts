import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { refundIdempotencyKey, startCleanup } from '@daisy/protocol/billing';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { fullRead } from './billing-payment-read.test-support';
import { sqlStateOf } from './constraint-helpers';
requireTestServices(process.env);
setupRitewayBun();
const authority = new URL(
  '../migrations/20261106110238_stripe_invoice_pass_authority/migration.sql',
  import.meta.url,
);
const forward = new URL(
  '../migrations/20261106223739_stripe_invoice_coverage_repair/migration.sql',
  import.meta.url,
);

test(
  'strict coverage repair preserves actual original-charge action identity, binding, period, allocation and linked observations',
  async () =>
    withClosedPurchase(true, async (input) => {
      const { fixture, subject, cleanup } = input;
      const read = await fullRead(input);
      const retained = await cleanup.recordPayment(subject.userId, read);
      const rollback = Error('Owned financial identity correction rollback');
      try {
        await fixture.sql.begin(async (tx) => {
          await tx`drop index if exists public.privacy_jobs_pending_vendor_due_idx`;
          const old = await Bun.file(authority).text();
          await tx.unsafe(
            old.slice(
              old.lastIndexOf(
                'CREATE OR REPLACE FUNCTION public.daisy_guard_stripe_cleanup()',
              ),
            ),
          );
          await tx`set local role daisy_web`;
          await tx`select id from users where id=${subject.userId} for update`;
          const [before] =
            await tx`select to_jsonb(row) as value from privacy_jobs row where subject_ref=${subject.userId} and vendor='stripe' for update`;
          const beforeFinance = await finances(tx, subject.userId);
          const [action] =
            await tx`select id,state,period_starts_at,period_ends_at from billing_refund_actions where user_id=${subject.userId}`;
          const key = refundIdempotencyKey({ id: action!.id });
          await tx`reset role`;
          await tx.unsafe(await Bun.file(forward).text());
          const [after] =
            await tx`select to_jsonb(row) as value from privacy_jobs row where id=${before!.value.id}`;
          const [sameAction] =
            await tx`select id,state,period_starts_at,period_ends_at from billing_refund_actions where user_id=${subject.userId}`;
          assert({
            given:
              'an actual current-service verified payment admission with one original-charge ready refund and linked observation before NULL-execution repair',
            should:
              'change only execution authority while retaining every money/source/link/recognition/key/period fact byte-for-byte and no additional restoration/action',
            actual: [
              beforeFinance?.actions.length,
              beforeFinance?.observations.length,
              retained,
              before!.value.billing_cleanup,
              after!.value,
              await finances(tx, subject.userId),
              sameAction,
              key,
              refundIdempotencyKey({ id: sameAction!.id }),
            ],
            expected: [
              1,
              1,
              'recorded',
              null,
              {
                ...before!.value,
                billing_cleanup: startCleanup(
                  before!.value.id,
                  new Date(before!.value.retry_at).toISOString(),
                ),
              },
              beforeFinance,
              action,
              `daisy-closure-refund:${action!.id}`,
              key,
            ],
          });
          await tx`set local role daisy_web`;
          await tx`savepoint forged_money`;
          const mutation = await sqlStateOf(
            () =>
              tx`update billing_refund_actions set amount_minor=amount_minor+1 where id=${action!.id}`,
          );
          await tx`rollback to savepoint forged_money`;
          await tx`release savepoint forged_money`;
          assert({
            given:
              'a direct daisy_web mutation of the original linked amount after migration',
            should:
              'retain immutable money authority and leave all facts unchanged',
            actual: [mutation, await finances(tx, subject.userId)],
            expected: ['23514', beforeFinance],
          });
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      } finally {
        await fixture.sql`delete from billing_payment_observations where user_id=${subject.userId}`;
        await fixture.sql`delete from billing_refund_actions where user_id=${subject.userId}`;
      }
    }),
  15_000,
);
async function finances(tx: import('bun').TransactionSQL, userId: string) {
  const [row] = await tx`select
 (select jsonb_agg(to_jsonb(row) order by row.id) from billing_purchases row where user_id=${userId}) as purchases,
 (select jsonb_agg(to_jsonb(row) order by row.id) from billing_refund_actions row where user_id=${userId}) as actions,
 (select jsonb_agg(to_jsonb(row) order by row.id) from billing_payment_observations row where user_id=${userId}) as observations,
 (select jsonb_agg(to_jsonb(row) order by row.user_id) from billing_customers row where user_id=${userId}) as customers`;
  return row;
}
