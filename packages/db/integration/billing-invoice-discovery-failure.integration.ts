import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
requireTestServices(process.env);
setupRitewayBun();

type Fixture = Parameters<Parameters<typeof withClosedPurchase>[1]>[0];
async function invoiceHead(input: Fixture) {
  for (let turn = 0; turn < 5; turn++) {
    await input.fixture
      .sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${input.jobId}`;
    await input.renew();
    const current = await input.cleanup.claim(input.jobId);
    if (
      current.kind !== 'claimed' ||
      current.state.kind === 'acknowledged' ||
      !current.state.claim
    )
      throw Error('Expected live discovery claim');
    const claimId = current.state.claim.id,
      work = current.work;
    if (
      work.kind === 'scan' &&
      work.lane === 'invoices' &&
      work.scan.kind === 'page'
    )
      return { ...current, claimId };
    if (work.kind !== 'scan' || work.scan.kind !== 'page')
      throw Error('Unexpected discovery fixture work');
    const result = await input.cleanup.record(input.jobId, {
      kind: 'page',
      claimId,
      work,
      ids: [],
      more: false,
    });
    if (result !== 'progress')
      throw Error('Expected positive empty fixture page progress');
  }
  throw Error('Invoice discovery did not appear within five lanes');
}

// Closed purchase setup and each prior genuine discovery step use their normal progress delays.
test(
  'incomplete owned invoice pages retain contradictions atomically without cursor progress or replay churn',
  async () =>
    withClosedPurchase(true, async (input) => {
      const { fixture, subject, session, cleanup, jobId } = input;
      try {
        const current = await invoiceHead(input),
          invoiceId = `in_${createId()}`;
        const [before] =
          await fixture.sql`select id,attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        // These are explicit producer adapter inputs, not claimed genuine Stripe reads.
        const reads = ['price_original', 'price_conflict'].map((priceId) => ({
          mode: 'test' as const,
          customerId: session.customerId,
          invoiceId,
          source: {
            kind: 'unresolved' as const,
            vendorSubscriptionId: session.subscriptionId,
            priceId,
          },
        }));
        const result = await cleanup.deferInvoicePage(
          jobId,
          current.claimId,
          current.work,
          { reads, retryAt: new Date(Date.now() + 60_000).toISOString() },
        );
        const [after] =
          await fixture.sql`select id,attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        const rows =
          await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
        const replay = await cleanup.deferInvoicePage(
          jobId,
          current.claimId,
          current.work,
          { reads, retryAt: new Date(Date.now() + 60_000).toISOString() },
        );
        const unchanged =
          await fixture.sql`select * from billing_payment_observations where user_id=${subject.userId}`;
        const [sameJob] =
          await fixture.sql`select id,attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        assert({
          given:
            'one current incomplete page with two positive contradictory observations of the exact same owned invoice',
          should:
            'persist one sticky owed identity with original source, consume one failure/yield and preserve all page positions, then replay without refresh',
          actual: {
            result,
            count: rows.length,
            invoice: rows[0]?.vendor_invoice_id,
            source: rows[0]?.source,
            state: rows[0]?.state,
            id: after?.id,
            attempts: after?.attempts,
            scans: after?.billing_cleanup.scans,
            claim: after?.billing_cleanup.claim,
            turnChanged:
              after?.billing_cleanup.turn !== before?.billing_cleanup.turn,
            replay,
            unchanged,
            sameJob,
          },
          expected: {
            result: 'failure',
            count: 1,
            invoice: invoiceId,
            source: reads[0]!.source,
            state: { kind: 'owed', reason: 'conflicting_evidence' },
            id: jobId,
            attempts: before!.attempts + 1,
            scans: before!.billing_cleanup.scans,
            claim: null,
            turnChanged: true,
            replay: 'idle',
            unchanged: rows,
            sameJob: after,
          },
        });
      } finally {
        await fixture.sql`delete from billing_payment_observations where user_id=${subject.userId}`;
      }
    }),
  15_000,
);
