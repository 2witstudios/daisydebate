import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

type ObservationColumns = {
  readonly kind: PgColumn;
  readonly mode: PgColumn;
  readonly vendorCustomerId: PgColumn;
  readonly vendorInvoiceId: PgColumn;
  readonly vendorInvoicePaymentId: PgColumn;
  readonly refundActionId: PgColumn;
  readonly closedAt: PgColumn;
  readonly observedAt: PgColumn;
  readonly source: PgColumn;
  readonly state: PgColumn;
};
const instant = (value: SQL) =>
  sql`(${value}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'`;
const period = (value: SQL) => sql`jsonb_typeof((${value}))='object'
  and (${value})-array['startsAt','endsAt']::text[]='{}'::jsonb
  and ${instant(sql`(${value})->>'startsAt'`)} and ${instant(sql`(${value})->>'endsAt'`)}
  and ((${value})->>'startsAt')::timestamptz<((${value})->>'endsAt')::timestamptz`;
const amount = (
  value: SQL,
  max: number,
) => sql`jsonb_typeof((${value}))='number'
  and ((${value})#>>'{}') ~ '^[0-9]+$' and ((${value})#>>'{}')::numeric<=${sql.raw(String(max))}`;

/** These CHECKs mirror the feature's portable evidence variants; they confer no money authority. */
export function paymentObservationSourceCheck(table: ObservationColumns) {
  const source = table.source;
  return sql`coalesce(
    (${source}->'vendorSubscriptionId'='null'::jsonb or (jsonb_typeof(${source}->'vendorSubscriptionId')='string'
      and (${source}->>'vendorSubscriptionId') ~ '^sub_[A-Za-z0-9_]+$' and length(${source}->>'vendorSubscriptionId')<=255))
    and (${source}->'priceId'='null'::jsonb or (jsonb_typeof(${source}->'priceId')='string'
      and (${source}->>'priceId') ~ '^price_[A-Za-z0-9_]+$' and length(${source}->>'priceId')<=255))
    and case ${source}->>'kind'
      when 'unresolved' then ${source}-array['kind','vendorSubscriptionId','priceId']::text[]='{}'::jsonb
      when 'purchase' then ${source}-array['kind','purchaseId','vendorSubscriptionId','priceId','admittedAt']::text[]='{}'::jsonb
        and jsonb_typeof(${source}->'vendorSubscriptionId')='string' and jsonb_typeof(${source}->'priceId')='string'
        and jsonb_typeof(${source}->'purchaseId')='string' and (${source}->>'purchaseId') ~ '^[a-z0-9]{24}$'
        and ${instant(sql`${source}->>'admittedAt'`)} and (${source}->>'admittedAt')::timestamptz<=${table.closedAt}
      else false end,false)`;
}

function partialFacts(value: SQL) {
  const charge = sql`(${value})->'charge'`;
  return sql`jsonb_typeof((${value}))='object' and (${value})-array['status','paidAtSeconds','amountPaidMinor','charge','period']::text[]='{}'::jsonb
    and ((${value})->'status'='null'::jsonb or (${value})->>'status' in ('open','paid','canceled'))
    and ((${value})->'paidAtSeconds'='null'::jsonb or ${amount(sql`(${value})->'paidAtSeconds'`, 9007199254740)})
    and ((${value})->'amountPaidMinor'='null'::jsonb or ${amount(sql`(${value})->'amountPaidMinor'`, Number.MAX_SAFE_INTEGER)})
    and ((${value})->'period'='null'::jsonb or ${period(sql`(${value})->'period'`)})
    and case (${charge})->>'kind' when 'unresolved' then (${charge})='{"kind":"unresolved"}'::jsonb
      when 'observed' then (${charge})-array['kind','id','paid','capturedMinor','currency']::text[]='{}'::jsonb
        and jsonb_typeof((${charge})->'id')='string' and ((${charge})->>'id') ~ '^ch_[A-Za-z0-9_]+$' and length((${charge})->>'id')<=255
        and ((${charge})->'paid'='null'::jsonb or jsonb_typeof((${charge})->'paid')='boolean')
        and ((${charge})->'capturedMinor'='null'::jsonb or ${amount(sql`(${charge})->'capturedMinor'`, Number.MAX_SAFE_INTEGER)})
        and ((${charge})->'currency'='null'::jsonb or (jsonb_typeof((${charge})->'currency')='string' and ((${charge})->>'currency') ~ '^[a-z]{3}$'))
      else false end`;
}
function ownedBinding(table: ObservationColumns, proof: SQL) {
  return sql`${table.source}->>'kind'='purchase'
    and (${proof})->>'mode'=${table.mode} and (${proof})->>'customerId'=${table.vendorCustomerId}
    and (${proof})->>'invoiceId'=${table.vendorInvoiceId} and (${proof})->>'invoicePaymentId'=${table.vendorInvoicePaymentId}
    and (${proof})->>'vendorSubscriptionId'=${table.source}->>'vendorSubscriptionId' and (${proof})->>'priceId'=${table.source}->>'priceId'
    and ${amount(sql`(${proof})->'paidAtSeconds'`, 9007199254740)}`;
}
function completePayment(table: ObservationColumns, proof: SQL) {
  return sql`jsonb_typeof((${proof}))='object' and ${ownedBinding(table, proof)}
    and (${proof})-array['mode','customerId','invoiceId','invoicePaymentId','vendorSubscriptionId','priceId','chargeId','amountMinor','currency','paidAtSeconds','period']::text[]='{}'::jsonb
    and jsonb_typeof((${proof})->'chargeId')='string' and ((${proof})->>'chargeId') ~ '^ch_[A-Za-z0-9_]+$' and length((${proof})->>'chargeId')<=255
    and ${amount(sql`(${proof})->'amountMinor'`, Number.MAX_SAFE_INTEGER)} and ((${proof})->>'amountMinor')::numeric>0
    and (${proof})->>'currency'='usd' and ${period(sql`(${proof})->'period'`)}`;
}
function preClosure(table: ObservationColumns, proof: SQL) {
  return sql`to_timestamp(((${proof})->>'paidAtSeconds')::double precision)+interval '1 second'<=${table.closedAt}
    and to_timestamp(((${proof})->>'paidAtSeconds')::double precision)<=${table.observedAt}`;
}
function paymentEvidence(table: ObservationColumns, evidence: SQL) {
  const proof = sql`(${evidence})->'proof'`;
  return sql`jsonb_typeof((${evidence}))='object' and case (${evidence})->>'kind'
    when 'partial' then (${evidence})-array['kind','facts']::text[]='{}'::jsonb and ${partialFacts(sql`(${evidence})->'facts'`)}
    when 'verified' then (${evidence})-array['kind','payment']::text[]='{}'::jsonb and ${completePayment(table, sql`(${evidence})->'payment'`)}
    when 'chronology' then (${evidence})-array['kind','proof','facts']::text[]='{}'::jsonb
      and (${proof})-array['mode','customerId','invoiceId','invoicePaymentId','vendorSubscriptionId','priceId','status','paidAtSeconds']::text[]='{}'::jsonb
      and ${ownedBinding(table, proof)} and (${proof})->>'status'='paid' and ${preClosure(table, proof)}
      and ${partialFacts(sql`(${evidence})->'facts'`)} and (${evidence})->'facts'->>'status'='paid'
      and (${evidence})->'facts'->'paidAtSeconds'=(${proof})->'paidAtSeconds'
    else false end`;
}
function invoiceState(state: PgColumn) {
  return sql`case ${state}->>'kind'
    when 'owed' then ${state}-array['kind','reason']::text[]='{}'::jsonb and ${state}->>'reason' in ('enumeration_unavailable','conflicting_evidence')
    when 'resolved' then ${state}-array['kind','basis','paymentCount','lastPaymentId']::text[]='{}'::jsonb
      and ${state}->>'basis'='enumeration_retained' and ${amount(sql`${state}->'paymentCount'`, Number.MAX_SAFE_INTEGER)}
      and (${state}->>'paymentCount')::numeric>0 and (${state}->>'lastPaymentId') ~ '^inpay_[A-Za-z0-9_]+$' and length(${state}->>'lastPaymentId')<=255
    else false end`;
}
export function paymentObservationStateCheck(table: ObservationColumns) {
  const state = table.state;
  const evidence = sql`${state}->'evidence'`;
  return sql`coalesce(case ${table.kind} when 'invoice' then ${invoiceState(state)}
    when 'payment' then case ${state}->>'kind'
      when 'owed' then ${state}-array['kind','reason','evidence']::text[]='{}'::jsonb
        and ${state}->>'reason' in ('payment_unresolved','chronology_ambiguous','refund_required','conflicting_evidence')
        and ${paymentEvidence(table, evidence)} and (${table.refundActionId} is null or
          (${state}->>'reason'='conflicting_evidence' and (${evidence})->>'kind'='verified'))
      when 'resolved' then ${table.refundActionId} is null and ${state}-array['kind','basis','evidence']::text[]='{}'::jsonb
        and ${state}->>'basis'='pre_closure' and ${paymentEvidence(table, evidence)}
        and case (${evidence})->>'kind' when 'chronology' then true
          when 'verified' then ${preClosure(table, sql`(${evidence})->'payment'`)} else false end
      when 'refund-linked' then ${table.refundActionId} is not null and ${state}-array['kind','payment']::text[]='{}'::jsonb
        and ${completePayment(table, sql`${state}->'payment'`)}
        and to_timestamp((${state}->'payment'->>'paidAtSeconds')::double precision)<=${table.observedAt}
      else false end else false end,false)`;
}
