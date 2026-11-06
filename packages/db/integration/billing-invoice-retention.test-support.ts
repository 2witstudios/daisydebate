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
    await cleanup.record(jobId, {
      kind: 'page',
      claimId: current.claimId,
      work: current.work,
      ids: lane === 2 ? [invoiceId, laterId] : [],
      more: false,
    });
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
