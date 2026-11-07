import type { TransactionSQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { retainCandidateInvoice } from './billing-cleanup-witness.test-support';
const lanes = [
  'purchases',
  'subscriptions',
  'invoices',
  'refunds',
  'observations',
] as const;
type Lane = (typeof lanes)[number];
type Frame =
  | { kind: 'page'; afterId: string | null }
  | { kind: 'complete' }
  | {
      kind: 'selected';
      id: string;
      rest: string[];
      lastId: string;
      more: boolean;
      detail:
        | { kind: 'resource' }
        | { kind: 'invoice-payments'; afterId: string | null };
    };
type Legacy =
  | {
      kind: 'scanning';
      jobId: string;
      retryAt: string;
      claim: Claim | null;
      turn: Lane;
      scans: Record<Lane, Frame>;
    }
  | { kind: 'deleting'; jobId: string; retryAt: string; claim: Claim | null };
export type InvoicePassLegacyState =
  | Legacy
  | {
      kind: 'acknowledged';
      outcome: 'vendor-deleted' | 'no-vendor-effects';
      jobId: string;
      checkedAt: string;
      nextAt: string;
    };
type Claim = { id: string; claimedAt: string; expiresAt: string };
export const invoicePassCohorts = [
  'pending-null',
  'head',
  'selected-purchases',
  'selected-subscriptions',
  'selected-invoices',
  'selected-refunds',
  'selected-observations',
  'selected-cursor',
  'claimed-invoices',
  'unrouted-invoices',
  'deleting',
  'acknowledged',
  'succeeded-null',
] as const;
export type InvoicePassCohort = (typeof invoicePassCohorts)[number];

/** Test-only immutable111 producer, not a runtime compatibility parser or financial classifier. */
export async function seedInvoicePassPredecessor(
  tx: TransactionSQL,
  jobId: string,
  cohort: InvoicePassCohort,
) {
  const read = async () =>
    (await tx`select * from privacy_jobs where id=${jobId}`)[0]!;
  if (cohort === 'pending-null') return read();
  if (cohort === 'succeeded-null') {
    // Caller installs the actual immutable109 generic NULL-execution producer for this cohort only.
    await tx`update privacy_jobs set status='succeeded',succeeded_at=clock_timestamp() where id=${jobId}`;
    return read();
  }
  const original = await read();
  const producer = legacyProducer(tx, jobId, original.retry_at.toISOString());
  await producer.claim();
  if (cohort === 'head') {
    await producer.failure();
    return read();
  }
  const selected = cohort !== 'deleting' && cohort !== 'acknowledged';
  const invoiceId = `in_${createId()}`,
    paymentId = `inpay_${createId()}`;
  if (selected && cohort !== 'unrouted-invoices')
    await retainCandidateInvoice(tx, jobId, invoiceId, paymentId);
  await selectPages(tx, jobId, producer, selected, invoiceId);
  if (cohort === 'acknowledged') await producer.acknowledge();
  else if (selected)
    await selectCohort(tx, jobId, producer, cohort, invoiceId, paymentId);
  return read();
}
function legacyProducer(tx: TransactionSQL, jobId: string, retryAt: string) {
  const now = async () =>
    ((await tx`select clock_timestamp() as at`)[0]!.at as Date).toISOString();
  let value: Legacy = {
    kind: 'scanning',
    jobId,
    retryAt,
    claim: null,
    turn: 'purchases',
    scans: Object.fromEntries(
      lanes.map((lane) => [lane, { kind: 'page', afterId: null }]),
    ) as Record<Lane, Frame>,
  };
  const persist = async (failure = false) => {
    if (value.claim)
      await tx`update privacy_jobs set billing_cleanup=${JSON.stringify(value)}::text::jsonb where id=${jobId}`;
    else
      await tx`update privacy_jobs set billing_cleanup=${JSON.stringify(value)}::text::jsonb,retry_at=${value.retryAt}::timestamptz,attempts=attempts+${failure ? 1 : 0} where id=${jobId}`;
  };
  const claim = async () => {
    await tx`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.005) from privacy_jobs where id=${jobId}`;
    const at = await now();
    value = {
      ...value,
      claim: {
        id: createId(),
        claimedAt: at,
        expiresAt: new Date(Date.parse(at) + 30000).toISOString(),
      },
    };
    await persist();
  };
  const scanning = () => {
    if (value.kind !== 'scanning') throw Error('Expected predecessor scan');
    return value;
  };
  const advance = async (frame: Frame, failure = false) => {
    const current = scanning(),
      scans = { ...current.scans, [current.turn]: frame };
    const turn = nextLane(current.turn, scans),
      due = new Date(Date.parse(await now()) + 1000).toISOString();
    value = turn
      ? { ...current, scans, turn, claim: null, retryAt: due }
      : { kind: 'deleting', jobId, retryAt: due, claim: null };
    await persist(failure);
  };
  return {
    claim,
    scanning,
    advance,
    failure: () => advance(scanning().scans[scanning().turn], true),
    async acknowledge() {
      await claim();
      const at = await now();
      const ack = {
        kind: 'acknowledged',
        outcome: 'vendor-deleted',
        jobId,
        checkedAt: at,
        nextAt: new Date(Date.parse(at) + 86400000).toISOString(),
      };
      await tx`update privacy_jobs set billing_cleanup=${JSON.stringify(ack)}::text::jsonb,status='succeeded',succeeded_at=${at}::timestamptz where id=${jobId}`;
    },
  };
}
function nextLane(turn: Lane, scans: Record<Lane, Frame>) {
  for (let n = 1; n <= lanes.length; n++) {
    const lane = lanes[(lanes.indexOf(turn) + n) % lanes.length]!;
    if (scans[lane].kind !== 'complete') return lane;
  }
  return null;
}
async function selectPages(
  tx: TransactionSQL,
  jobId: string,
  producer: ReturnType<typeof legacyProducer>,
  selected: boolean,
  invoiceId: string,
) {
  for (let index = 0; index < lanes.length; index++) {
    if (index > 0) await producer.claim();
    const current = producer.scanning();
    const ids = selected
      ? await selectedIds(tx, jobId, current.turn, invoiceId)
      : [];
    const [first, ...rest] = ids;
    await producer.advance(
      first
        ? {
            kind: 'selected',
            id: first,
            rest,
            lastId: ids.at(-1)!,
            more: false,
            detail:
              current.turn === 'invoices'
                ? { kind: 'invoice-payments', afterId: null }
                : { kind: 'resource' },
          }
        : { kind: 'complete' },
    );
  }
}
async function selectedIds(
  tx: TransactionSQL,
  jobId: string,
  lane: Lane,
  invoiceId: string,
) {
  if (lane === 'observations')
    return (
      await tx`select id from billing_payment_observations where user_id=(select subject_ref from privacy_jobs where id=${jobId}) order by id limit 20`
    ).map((row: { id: string }) => row.id) as string[];
  if (lane === 'subscriptions')
    return [`sub_${createId()}`, `sub_${createId()}`];
  return lane === 'invoices'
    ? [invoiceId, `in_${createId()}`]
    : [createId(), createId()];
}
async function selectCohort(
  tx: TransactionSQL,
  jobId: string,
  producer: ReturnType<typeof legacyProducer>,
  cohort: InvoicePassCohort,
  invoiceId: string,
  paymentId: string,
) {
  const target: Lane =
    cohort === 'selected-cursor' ||
    cohort === 'claimed-invoices' ||
    cohort === 'unrouted-invoices'
      ? 'invoices'
      : (cohort.slice('selected-'.length) as Lane);
  for (
    let n = 0;
    producer.scanning().turn !== target && n < lanes.length;
    n++
  ) {
    await producer.claim();
    await producer.failure();
  }
  if (producer.scanning().turn !== target)
    throw Error('Predecessor target unavailable');
  if (cohort === 'selected-cursor') {
    await producer.claim();
    await retainCandidateInvoice(tx, jobId, invoiceId, paymentId);
    const frame = producer.scanning().scans.invoices;
    if (frame.kind !== 'selected') throw Error('Missing predecessor invoice');
    await producer.advance({
      ...frame,
      detail: { kind: 'invoice-payments', afterId: paymentId },
    });
  }
  if (cohort === 'claimed-invoices') await producer.claim();
}

/** Legal immutable111 trajectory: old enumeration consumed, only a failing refund HEAD remains. */
export async function seedCompletedInvoicePredecessor(
  tx: TransactionSQL,
  jobId: string,
  invoiceId: string,
  observationIds: readonly string[],
) {
  if (observationIds.length === 0 || observationIds.length > 20)
    throw Error('Expected bounded positive historical observations');
  const [row] = await tx`select retry_at from privacy_jobs where id=${jobId}`;
  const producer = legacyProducer(tx, jobId, row!.retry_at.toISOString());
  for (let lane = 0; lane < 2; lane++) {
    await producer.claim();
    await producer.advance({ kind: 'complete' });
  }
  await producer.claim();
  await producer.advance({
    kind: 'selected',
    id: invoiceId,
    rest: [],
    lastId: invoiceId,
    more: false,
    detail: { kind: 'invoice-payments', afterId: null },
  });
  await producer.claim();
  await producer.failure();
  await producer.claim();
  await producer.advance({
    kind: 'selected',
    id: observationIds[0]!,
    rest: observationIds.slice(1),
    lastId: observationIds.at(-1)!,
    more: false,
    detail: { kind: 'resource' },
  });
  await producer.claim();
  // Controlled historical producer supplies the same positive invoice proof after this claim.
  // The immutable111 writer recognized each supplied read; this is not current runtime freshness.
  await tx`update billing_payment_observations set observed_at=date_trunc('milliseconds',clock_timestamp())
    where user_id=(select subject_ref from privacy_jobs where id=${jobId}) and kind='invoice' and vendor_invoice_id=${invoiceId}`;
  await producer.advance({ kind: 'complete' });
  for (let index = 0; index < observationIds.length; index++) {
    await producer.claim();
    await producer.failure();
    await producer.claim();
    const selected = producer.scanning().scans.observations;
    if (selected.kind !== 'selected')
      throw Error('Missing historical selected observation');
    // Supply the exact selected positive historical fixture again, preserving its classified facts.
    await tx`update billing_payment_observations set observed_at=date_trunc('milliseconds',clock_timestamp())
      where id=${selected.id} and user_id=(select subject_ref from privacy_jobs where id=${jobId})`;
    await producer.advance(
      selected.rest.length
        ? { ...selected, id: selected.rest[0]!, rest: selected.rest.slice(1) }
        : { kind: 'complete' },
    );
  }
  const state = producer.scanning();
  if (
    state.turn !== 'refunds' ||
    state.scans.invoices.kind !== 'complete' ||
    state.scans.observations.kind !== 'complete'
  )
    throw Error('Historical completion cohort not reached');
  return state;
}

/** Guarded111 trajectory leaves an earlier resolved witness behind both selected traversal tails. */
export async function seedInvoiceTailPredecessor(
  tx: TransactionSQL,
  jobId: string,
  invoiceIds: readonly [string, string, string],
  observationIds: readonly [string, string, string, string],
  target: 'invoices' | 'observations',
) {
  const [row] = await tx`select retry_at from privacy_jobs where id=${jobId}`;
  const producer = legacyProducer(tx, jobId, row!.retry_at.toISOString());
  for (let n = 0; n < 2; n++) {
    await producer.claim();
    await producer.advance({ kind: 'complete' });
  }
  await producer.claim();
  await producer.advance({
    kind: 'selected',
    id: invoiceIds[0],
    rest: invoiceIds.slice(1),
    lastId: invoiceIds[2],
    more: false,
    detail: { kind: 'invoice-payments', afterId: null },
  });
  await producer.claim();
  await producer.failure();
  await producer.claim();
  await producer.advance({
    kind: 'selected',
    id: observationIds[0],
    rest: observationIds.slice(1),
    lastId: observationIds[3],
    more: false,
    detail: { kind: 'resource' },
  });
  await producer.claim();
  await tx`update billing_payment_observations set observed_at=date_trunc('milliseconds',clock_timestamp()) where user_id=(select subject_ref from privacy_jobs where id=${jobId}) and kind='invoice' and vendor_invoice_id=${invoiceIds[0]}`;
  await producer.advance({
    kind: 'selected',
    id: invoiceIds[1],
    rest: [invoiceIds[2]],
    lastId: invoiceIds[2],
    more: false,
    detail: { kind: 'invoice-payments', afterId: null },
  });
  await producer.claim();
  await producer.failure();
  await producer.claim();
  await recognizeAndAdvance(0);
  if (target === 'observations') {
    await producer.claim();
    await producer.failure();
    await producer.claim();
    await producer.failure();
    await producer.claim();
    await recognizeAndAdvance(1);
    await producer.claim();
    await producer.failure();
    await producer.claim();
    await producer.failure();
  }
  if (producer.scanning().turn !== target)
    throw Error('Missing exact historical tail turn');
  return producer.scanning();
  async function recognizeAndAdvance(index: number) {
    const id = observationIds[index]!;
    // Positive historical fixture is supplied after this claim; known facts remain identical.
    await tx`update billing_payment_observations set observed_at=date_trunc('milliseconds',clock_timestamp()) where id=${id} and user_id=(select subject_ref from privacy_jobs where id=${jobId})`;
    await producer.advance({
      kind: 'selected',
      id: observationIds[index + 1]!,
      rest: observationIds.slice(index + 2),
      lastId: observationIds[3],
      more: false,
      detail: { kind: 'resource' },
    });
  }
}
