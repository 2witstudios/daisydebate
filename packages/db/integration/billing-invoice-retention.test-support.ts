import { createId } from '@paralleldrive/cuid2';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';

type Fixture = Parameters<Parameters<typeof withClosedPurchase>[1]>[0];

async function selectInvoice(input: Fixture) {
  const { fixture, cleanup, jobId, renew, session } = input;
  const invoiceId = `in_${createId()}`,
    laterId = `in_${createId()}`;
  const claim = async () => {
    await fixture.sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
    await renew();
    const result = await cleanup.claim(jobId);
    if (
      result.kind !== 'claimed' ||
      result.state.kind === 'acknowledged' ||
      !result.state.claim
    )
      throw Error('Missing current invoice retention claim');
    return { ...result, claimId: result.state.claim.id };
  };
  for (let lane = 0; lane < 5; lane++) {
    const current = await claim();
    const observationPage =
      current.work.kind === 'scan' && current.work.lane === 'observations'
        ? await cleanup.observations(jobId, current.claimId, current.work, null)
        : null;
    if (observationPage && observationPage.kind !== 'observations')
      throw Error('Invoice setup observation read refused');
    const progress =
      current.work.kind === 'scan' && current.work.lane === 'invoices'
        ? await cleanup.retainInvoicePage(
            jobId,
            current.claimId,
            current.work,
            {
              reads: [invoiceId, laterId].map((invoiceId) => ({
                mode: 'test',
                customerId: session.customerId,
                invoiceId,
                source: {
                  kind: 'unresolved',
                  vendorSubscriptionId: null,
                  priceId: null,
                },
              })),
              more: false,
            },
          )
        : await cleanup.record(jobId, {
            kind: 'page',
            claimId: current.claimId,
            work: current.work,
            ids:
              observationPage?.kind === 'observations'
                ? observationPage.observations.map((row) => row.id)
                : [],
            more:
              observationPage?.kind === 'observations'
                ? observationPage.more
                : false,
          });
    if (progress !== 'progress') throw Error('Invoice setup discovery refused');
  }
  const current = await claim();
  const offer = await cleanup.frozenOffer(
    jobId,
    current.claimId,
    current.work,
    session.subscriptionId,
  );
  if (offer.kind !== 'owned') throw Error('Missing frozen owned invoice offer');
  return {
    current,
    claim,
    claimInvoice: async () => {
      for (let turn = 0; turn < 5; turn++) {
        const next = await claim();
        if (next.work.kind === 'scan' && next.work.lane === 'invoices')
          return next;
        if (
          next.work.kind !== 'scan' ||
          next.work.lane !== 'observations' ||
          next.work.scan.kind !== 'selected' ||
          (await cleanup.retainObservation(jobId, next.claimId, next.work)) !==
            'progress'
        )
          throw Error('Unexpected intervening invoice work');
      }
      throw Error('Invoice work did not return within bounded lanes');
    },
    invoiceId,
    laterId,
    read: {
      mode: offer.owner.mode,
      customerId: offer.owner.customerId,
      invoiceId,
      source: offer.source,
    },
  };
}

export function withSelectedInvoice(
  work: (
    input: Fixture & Awaited<ReturnType<typeof selectInvoice>>,
  ) => Promise<void>,
) {
  return withClosedPurchase(true, async (input) => {
    try {
      await work({ ...input, ...(await selectInvoice(input)) });
    } finally {
      await input.fixture
        .sql`delete from billing_payment_observations where user_id=${input.subject.userId}`;
    }
  });
}
