import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withSelectedInvoice } from './billing-invoice-retention.test-support';
requireTestServices(process.env);
setupRitewayBun();

test(
  'a payment and invoice witness commit before exactly one selected payment cursor advance, while stale replay refuses',
  async () =>
    withSelectedInvoice(
      async ({
        fixture,
        subject,
        cleanup,
        jobId,
        current,
        read,
        invoiceId,
        laterId,
      }) => {
        const paymentId = `inpay_${createId()}`;
        const payment = {
          ...read,
          invoicePaymentId: paymentId,
          evidence: {
            kind: 'partial',
            facts: {
              status: null,
              paidAtSeconds: null,
              amountPaidMinor: null,
              charge: { kind: 'unresolved' },
              period: null,
            },
          },
        };
        const foreign = await cleanup.retainPayment(
          jobId,
          current.claimId,
          current.work,
          { ...payment, invoiceId: 'in_foreign' },
        );
        const progress = await cleanup.retainPayment(
          jobId,
          current.claimId,
          current.work,
          payment,
        );
        const [beforeReplay] =
          await fixture.sql`select billing_cleanup,attempts,retry_at from privacy_jobs where id=${jobId}`;
        const beforeRows =
          await fixture.sql`select id,kind,vendor_invoice_id,vendor_invoice_payment_id,source,state,observed_at from billing_payment_observations where user_id=${subject.userId} order by kind`;
        const replay = await cleanup.retainPayment(
          jobId,
          current.claimId,
          current.work,
          payment,
        );
        const afterRows =
          await fixture.sql`select id,kind,vendor_invoice_id,vendor_invoice_payment_id,source,state,observed_at from billing_payment_observations where user_id=${subject.userId} order by kind`;
        const [afterReplay] =
          await fixture.sql`select billing_cleanup,attempts,retry_at from privacy_jobs where id=${jobId}`;
        assert({
          given:
            'one selected invoice with a later selected invoice remainder and one honest unknown payment',
          should:
            'retain both exact obligations, advance only its payment cursor, preserve source/remainder/accounting and make stale replay entirely idle',
          actual: [
            foreign,
            progress,
            replay,
            beforeRows.map(
              (row: {
                kind: string;
                vendor_invoice_id: string;
                vendor_invoice_payment_id: string | null;
                source: unknown;
                state: { kind: string };
              }) => [
                row.kind,
                row.vendor_invoice_id,
                row.vendor_invoice_payment_id,
                row.source,
                row.state.kind,
              ],
            ),
            beforeReplay!.billing_cleanup.scans.invoices,
            afterReplay,
            afterRows,
            beforeReplay!.attempts,
          ],
          expected: [
            'idle',
            'progress',
            'idle',
            [
              ['invoice', invoiceId, null, read.source, 'owed'],
              ['payment', invoiceId, paymentId, read.source, 'owed'],
            ],
            {
              kind: 'selected',
              id: invoiceId,
              rest: [laterId],
              lastId: laterId,
              more: false,
              detail: { kind: 'invoice-payments', afterId: paymentId },
            },
            beforeReplay,
            beforeRows,
            0,
          ],
        });
      },
    ),
  15000,
);
