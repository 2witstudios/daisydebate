import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import {
  installHistoricalInvoiceObservationProducer,
  seedHistoricalInvoiceFacts,
} from './billing-invoice-historical-facts.test-support';
import { seedInvoiceTailPredecessor } from './billing-invoice-pass-predecessor.test-support';
requireTestServices(process.env);
setupRitewayBun();
const previous = new URL(
  '../migrations/20261106023226_stripe_cleanup_failure_classification/migration.sql',
  import.meta.url,
);
const authority = new URL(
  '../migrations/20261106110238_stripe_invoice_pass_authority/migration.sql',
  import.meta.url,
);
const forward = new URL(
  '../migrations/20261106223739_stripe_invoice_coverage_repair/migration.sql',
  import.meta.url,
);
for (const target of ['invoices', 'observations'] as const)
  test(
    `resolved invoice before selected ${target} tail remains an independent fresh obligation`,
    async () =>
      withClosedPurchase(true, async ({ fixture, subject, session, jobId }) => {
        const rollback = Error('Owned selected-tail repair rollback');
        try {
          await fixture.sql.begin(async (tx) => {
            await tx`drop index if exists public.privacy_jobs_pending_vendor_due_idx`;
            await tx.unsafe(await Bun.file(previous).text());
            await installHistoricalInvoiceObservationProducer(tx);
            await tx`set local role daisy_web`;
            await tx`select id from users where id=${subject.userId} for update`;
            const observationIds = [
              createId(),
              createId(),
              createId(),
              createId(),
            ].sort() as [string, string, string, string];
            const invoiceIds = [
              `in_${createId()}`,
              `in_${createId()}`,
              `in_${createId()}`,
            ] as const;
            const [memberId, witnessId, laterId, lastId] = observationIds;
            const source = await seedHistoricalInvoiceFacts(tx, {
              userId: subject.userId,
              customerId: session.customerId,
              subscriptionId: session.subscriptionId,
              invoiceId: invoiceIds[0],
              paymentId: `inpay_${createId()}`,
              memberId,
              witnessId,
            });
            for (const [id, invoiceId] of [
              [laterId, invoiceIds[1]],
              [lastId, invoiceIds[2]],
            ] as const)
              await tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
      insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,source,state,closed_at,created_at,observed_at)
      select ${id},${subject.userId},'test',${session.customerId},${invoiceId},'invoice','{"kind":"unresolved","vendorSubscriptionId":null,"priceId":null}'::jsonb,'{"kind":"owed","reason":"enumeration_unavailable"}'::jsonb,date_trunc('milliseconds',deleted_at),at,at from users cross join sampled where users.id=${subject.userId}`;
            await seedInvoiceTailPredecessor(
              tx,
              jobId,
              invoiceIds,
              observationIds,
              target,
            );
            await tx`reset role`;
            await tx.unsafe(await Bun.file(authority).text());
            const [before] =
              await tx`select to_jsonb(row) as value from privacy_jobs row where id=${jobId}`;
            const untouched =
              await tx`select to_jsonb(row) as value from billing_payment_observations row where user_id=${subject.userId} and id<>${witnessId} order by id`;
            const [witness] =
              await tx`select to_jsonb(row) as value from billing_payment_observations row where id=${witnessId}`;
            await tx.unsafe(await Bun.file(forward).text());
            const [after] =
              await tx`select to_jsonb(row) as value from privacy_jobs row where id=${jobId}`;
            const [rearmed] =
              await tx`select to_jsonb(row) as value,clock_timestamp() as at from billing_payment_observations row where id=${witnessId}`;
            const afterUntouched =
              await tx`select to_jsonb(row) as value from billing_payment_observations row where user_id=${subject.userId} and id<>${witnessId} order by id`;
            const expected = {
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
            };
            const {
              state: oldState,
              observed_at: oldObserved,
              ...oldFacts
            } = witness!.value;
            const { state, observed_at, ...facts } = rearmed!.value;
            assert({
              given: `actual111 consumed historical coverage behind both current112 selected tails, with ${target} selected as current work`,
              should:
                'preserve every selected ID/remainder/position and original money/source fact while rearming the earlier invoice independently of tail membership',
              actual: {
                priorBasis: oldState.basis,
                priorSource: witness!.value.source,
                turn: before!.value.billing_cleanup.turn,
                invoice: before!.value.billing_cleanup.scans.invoices.id,
                observation:
                  before!.value.billing_cleanup.scans.observations.id,
                queue: after!.value,
                untouched: afterUntouched,
                state,
                facts,
                recognitionWithin:
                  new Date(observed_at).getTime() >=
                    new Date(oldObserved).getTime() &&
                  new Date(observed_at).getTime() <= rearmed!.at.getTime(),
              },
              expected: {
                priorBasis: 'enumeration_retained',
                priorSource: source,
                turn: target,
                invoice: invoiceIds[1],
                observation: target === 'invoices' ? witnessId : laterId,
                queue: { ...before!.value, billing_cleanup: expected },
                untouched,
                state: { kind: 'owed', reason: 'enumeration_unavailable' },
                facts: oldFacts,
                recognitionWithin: true,
              },
            });
            throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
      }),
    25_000,
  );
// The observations trajectory includes twelve mandatory one-second legacy progress/failure intervals.
