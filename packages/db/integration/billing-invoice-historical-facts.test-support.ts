import type { TransactionSQL } from 'bun';
const producer = new URL(
  '../migrations/20261106000213_billing_payment_observations/migration.sql',
  import.meta.url,
);

/** Exact historical guard, retained for populated accounting tests only. No trigger is disabled. */
export async function installHistoricalInvoiceObservationProducer(
  tx: TransactionSQL,
) {
  const sql = await Bun.file(producer).text();
  const begin = sql.indexOf(
    'CREATE FUNCTION public.daisy_guard_billing_payment_observation()',
  );
  const end =
    sql.indexOf('$payment_observation$;', begin) +
    '$payment_observation$;'.length;
  if (begin < 0 || end < begin)
    throw Error('Historical observation producer absent');
  await tx.unsafe(
    sql
      .slice(begin, end)
      .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'),
  );
}

/** Controlled positive chronology/coverage data, not claimed Stripe execution or new refund authority. */
export async function seedHistoricalInvoiceFacts(
  tx: TransactionSQL,
  input: {
    readonly userId: string;
    readonly customerId: string;
    readonly subscriptionId: string;
    readonly invoiceId: string;
    readonly paymentId: string;
    readonly memberId: string;
    readonly witnessId: string;
  },
) {
  const [purchase] =
    await tx`select id,admitted_at from billing_purchases where user_id=${input.userId} and state->>'kind'='complete'`;
  const [clock] =
    await tx`select date_trunc('milliseconds',deleted_at) as closed,date_trunc('milliseconds',clock_timestamp()) as at from users where id=${input.userId}`;
  const source = {
    kind: 'purchase' as const,
    purchaseId: purchase!.id,
    admittedAt: purchase!.admitted_at.toISOString(),
    vendorSubscriptionId: input.subscriptionId,
    priceId: 'price_fixture',
  };
  const paidAtSeconds = Math.floor(clock!.closed.getTime() / 1000) - 1;
  const facts = {
    status: 'paid',
    paidAtSeconds,
    amountPaidMinor: null,
    charge: { kind: 'unresolved' },
    period: null,
  };
  const state = {
    kind: 'resolved',
    basis: 'pre_closure',
    evidence: {
      kind: 'chronology',
      proof: {
        mode: 'test',
        customerId: input.customerId,
        invoiceId: input.invoiceId,
        invoicePaymentId: input.paymentId,
        vendorSubscriptionId: input.subscriptionId,
        priceId: 'price_fixture',
        status: 'paid',
        paidAtSeconds,
      },
      facts,
    },
  };
  const coverage = {
    kind: 'resolved',
    basis: 'enumeration_retained',
    paymentCount: 1,
    lastPaymentId: input.paymentId,
  };
  await tx`insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,vendor_invoice_payment_id,source,state,closed_at,created_at,observed_at)
    values(${input.memberId},${input.userId},'test',${input.customerId},${input.invoiceId},'payment',${input.paymentId},${JSON.stringify(source)}::text::jsonb,${JSON.stringify(state)}::text::jsonb,${clock!.closed},${clock!.at},${clock!.at})`;
  await tx`insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,source,state,closed_at,created_at,observed_at)
    values(${input.witnessId},${input.userId},'test',${input.customerId},${input.invoiceId},'invoice',${JSON.stringify(source)}::text::jsonb,${JSON.stringify(coverage)}::text::jsonb,${clock!.closed},${clock!.at},${clock!.at})`;
  return source;
}
