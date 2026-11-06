import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { invoicePassOwnerSchema } from '@daisy/protocol/billing';
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
        claimInvoice,
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
        const [account] =
          await fixture.sql`select deleted_at from users where id=${subject.userId}`;
        if (read.source.kind !== 'purchase')
          throw Error('Expected original offer');
        const owner = invoicePassOwnerSchema.parse({
          ...read,
          userId: subject.userId,
          closedAt: account!.deleted_at.toISOString(),
          period: {
            startsAt: read.source.admittedAt,
            endsAt: new Date(
              Date.parse(read.source.admittedAt) + 30 * 86400000,
            ).toISOString(),
          },
        });
        const passId = createId();
        const foreign = await cleanup.invoicePassStep(
          jobId,
          current.claimId,
          current.work,
          {
            kind: 'start',
            passId,
            owner: { ...owner, invoiceId: 'in_foreign' },
          },
        );
        const started = await cleanup.invoicePassStep(
          jobId,
          current.claimId,
          current.work,
          { kind: 'start', passId, owner },
        );
        const active = await claimInvoice();
        const progress = await cleanup.invoicePassStep(
          jobId,
          active.claimId,
          active.work,
          {
            kind: 'advance',
            event: {
              kind: 'retained',
              beforeId: null,
              read: payment,
              more: true,
            },
          },
        );
        const [beforeReplay] =
          await fixture.sql`select billing_cleanup,attempts,retry_at from privacy_jobs where id=${jobId}`;
        const beforeRows =
          await fixture.sql`select id,kind,vendor_invoice_id,vendor_invoice_payment_id,source,state,observed_at from billing_payment_observations where user_id=${subject.userId} and vendor_invoice_id=${invoiceId} order by kind`;
        const replay = await cleanup.invoicePassStep(
          jobId,
          active.claimId,
          active.work,
          {
            kind: 'advance',
            event: {
              kind: 'retained',
              beforeId: null,
              read: payment,
              more: true,
            },
          },
        );
        const afterRows =
          await fixture.sql`select id,kind,vendor_invoice_id,vendor_invoice_payment_id,source,state,observed_at from billing_payment_observations where user_id=${subject.userId} and vendor_invoice_id=${invoiceId} order by kind`;
        const [afterReplay] =
          await fixture.sql`select billing_cleanup,attempts,retry_at from privacy_jobs where id=${jobId}`;
        const remainder =
          await fixture.sql`select source,state from billing_payment_observations where user_id=${subject.userId} and vendor_invoice_id=${laterId}`;
        assert({
          given:
            'one selected invoice with a later selected invoice remainder and one honest unknown payment',
          should:
            'retain both exact obligations, advance only its payment cursor, preserve source/remainder/accounting and make stale replay entirely idle',
          actual: [
            remainder,
            foreign,
            started,
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
            [
              {
                source: {
                  kind: 'unresolved',
                  vendorSubscriptionId: null,
                  priceId: null,
                },
                state: { kind: 'owed', reason: 'enumeration_unavailable' },
              },
            ],
            'idle',
            'progress',
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
              detail: {
                kind: 'invoice-payments',
                pass: {
                  id: passId,
                  jobId,
                  beganAt:
                    active.work.kind === 'scan' &&
                    active.work.scan.kind === 'selected' &&
                    active.work.scan.detail.kind === 'invoice-payments'
                      ? active.work.scan.detail.pass!.beganAt
                      : null,
                  owner,
                  phase: 'retaining',
                  afterId: paymentId,
                  comparison: { kind: 'bounded', reads: [payment] },
                },
              },
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
