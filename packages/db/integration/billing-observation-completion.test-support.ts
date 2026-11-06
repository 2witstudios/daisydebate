import { createId } from '@paralleldrive/cuid2';
import type { CleanupWork } from '@daisy/protocol/billing';
import { createDatabase } from '../src/index';
import { requireTestServices } from '@daisy/config';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
const { databaseUrl } = requireTestServices(process.env);
type Fixture = Parameters<Parameters<typeof withClosedPurchase>[1]>[0];

async function prepareCompletion(input: Fixture) {
  const { fixture, subject, session, pool, instanceId, cleanup, renew } = input;
  const [original] =
    await fixture.sql`select id,admitted_at from billing_purchases where user_id=${subject.userId} and state->>'kind'='complete'`;
  const [account] =
    await fixture.sql`select deleted_at from users where id=${subject.userId}`;
  const paidAtSeconds = Math.floor(account!.deleted_at.getTime() / 1000) + 1;
  await fixture.sql`select pg_sleep(greatest(0,extract(epoch from to_timestamp(${paidAtSeconds})-clock_timestamp()))+.01)`;
  const payment = {
    mode: 'test' as const,
    customerId: session.customerId,
    invoiceId: `in_${createId()}`,
    vendorSubscriptionId: session.subscriptionId,
    chargeId: `ch_${createId()}`,
    amountMinor: 1000,
    currency: 'usd' as const,
    paidAtSeconds,
    period: {
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z',
    },
  };
  const database = createDatabase({
      url: databaseUrl,
      client: pool,
      nextActorId: createId,
    }),
    refunds = database.billingRefunds(instanceId);
  await renew();
  const admitted = await refunds.admit(subject.userId, payment);
  const action = 'action' in admitted ? admitted.action : null;
  if (!action) throw Error('Missing original refund');
  const first = await refunds.claim(action.id),
    refundId = `re_${createId()}`;
  if (!first?.action.claim) throw Error('Missing original refund claim');
  await refunds.record(action.id, {
    kind: 'observe',
    claimId: first.action.claim.id,
    refundId,
    status: 'succeeded',
  });
  const source = {
    kind: 'purchase',
    purchaseId: original!.id,
    vendorSubscriptionId: session.subscriptionId,
    priceId: 'price_fixture',
    admittedAt: original!.admitted_at.toISOString(),
  };
  const observationId = createId(),
    invoicePaymentId = `inpay_${createId()}`;
  const state = {
    kind: 'refund-linked',
    payment: { ...payment, invoicePaymentId, priceId: 'price_fixture' },
  };
  await fixture.sql.begin(async (tx) => {
    await tx`set local role daisy_web`;
    await tx`select * from public.daisy_authorization_accounts_v2(array[${subject.actorId}]::text[],null::text,true)`;
    await tx`select id from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe' for update`;
    await tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
      insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,vendor_invoice_payment_id,refund_action_id,source,state,closed_at,created_at,observed_at)
      select ${observationId},id,'test',${payment.customerId},${payment.invoiceId},'payment',${invoicePaymentId},${action.id},${JSON.stringify(source)}::text::jsonb,${JSON.stringify(state)}::text::jsonb,deleted_at,sampled.at,sampled.at from users cross join sampled where id=${subject.userId}`;
  });
  await fixture.sql`delete from billing_customers where user_id=${subject.userId}`;
  const [row] =
    await fixture.sql`select id from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
  const jobId = row!.id as string;
  const claim = async () => {
    await fixture.sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
    await renew();
    const current = await cleanup.claim(jobId);
    if (
      current.kind !== 'claimed' ||
      current.state.kind === 'acknowledged' ||
      !current.state.claim
    )
      throw Error('Missing completion claim');
    return { ...current, claimId: current.state.claim.id };
  };
  for (let lane = 0; lane < 4; lane++) {
    const current = await claim();
    await cleanup.record(jobId, {
      kind: 'page',
      claimId: current.claimId,
      work: current.work,
      ids: [],
      more: false,
    });
  }
  await retainCompletionObservation(cleanup, jobId, claim);
  const current = await claim();
  if (
    current.work.kind !== 'delete' ||
    current.facts.effects.owedObservations !== false
  )
    throw Error('Missing current settled completion facts');
  const completion = {
    kind: 'deleted' as const,
    claimId: current.claimId,
    work: current.work,
  };
  const retrieval = await refunds.claim(action.id);
  if (!retrieval?.action.claim) throw Error('Missing independent action read');
  const reversal = {
    kind: 'observe' as const,
    claimId: retrieval.action.claim.id,
    refundId,
    status: 'failed' as const,
  };
  return {
    refunds,
    jobId,
    actionId: action.id,
    observationId,
    completion,
    reversal,
    payment,
  };
}

export async function withObservationCompletion(
  work: (
    input: Fixture & Awaited<ReturnType<typeof prepareCompletion>>,
  ) => Promise<void>,
) {
  return withClosedPurchase(true, async (input) => {
    try {
      return await work({ ...input, ...(await prepareCompletion(input)) });
    } finally {
      await input.fixture
        .sql`delete from billing_payment_observations where user_id=${input.subject.userId}`;
      await input.fixture
        .sql`delete from billing_refund_actions where user_id=${input.subject.userId}`;
    }
  });
}

async function retainCompletionObservation(
  cleanup: Fixture['cleanup'],
  jobId: string,
  claim: () => Promise<{
    readonly claimId: string;
    readonly work: CleanupWork;
  }>,
) {
  const observationPage = await claim();
  const rows = await cleanup.observations(
    jobId,
    observationPage.claimId,
    observationPage.work,
    null,
  );
  if (rows.kind !== 'observations')
    throw Error('Missing current observation page');
  await cleanup.record(jobId, {
    kind: 'page',
    claimId: observationPage.claimId,
    work: observationPage.work,
    ids: rows.observations.map((row) => row.id),
    more: rows.more,
  });
  const selectedObservation = await claim();
  const retained = await cleanup.retainObservation(
    jobId,
    selectedObservation.claimId,
    selectedObservation.work,
  );
  if (retained !== 'progress')
    throw Error('Missing current settled observation retention');
}
