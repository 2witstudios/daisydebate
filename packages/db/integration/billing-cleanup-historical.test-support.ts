import type { TransactionSQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';

const lanes = ['purchases', 'subscriptions', 'invoices', 'refunds'] as const;
type HistoricalLane = (typeof lanes)[number];
// Immutable predecessor wire shape; never a runtime compatibility parser.
type HistoricalScan =
  | { readonly kind: 'page'; readonly afterId: string | null }
  | { readonly kind: 'complete' }
  | {
      readonly kind: 'selected';
      readonly id: string;
      readonly rest: readonly string[];
      readonly lastId: string;
      readonly more: boolean;
      readonly detail:
        | { readonly kind: 'resource' }
        | {
            readonly kind: 'invoice-payments';
            readonly afterId: string | null;
          };
    };
type Scans = Record<HistoricalLane, HistoricalScan>;
type Claim = {
  readonly id: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
};
type HistoricalState = {
  readonly jobId: string;
  readonly retryAt: string;
  readonly claim: Claim | null;
} & (
  | {
      readonly kind: 'scanning';
      readonly turn: HistoricalLane;
      readonly scans: Scans;
    }
  | { readonly kind: 'deleting' }
);
export const historicalCohorts = [
  'pending-null',
  'page',
  'selected-remainder',
  'claimed',
  'deleting',
  'acknowledged',
  'succeeded-null',
] as const;
export type HistoricalCohort = (typeof historicalCohorts)[number];

/** Test-only predecessor writer: every fixture transition is checked by the immutable109 runtime guard. */
export async function seedHistoricalCleanup(
  tx: TransactionSQL,
  jobId: string,
  cohort: HistoricalCohort,
) {
  const read = async () =>
    (await tx`select * from privacy_jobs where id=${jobId}`)[0]!;
  const original = await read();
  if (cohort === 'pending-null') return { before: original, oldClaim: null };
  if (cohort === 'succeeded-null') {
    await tx`update privacy_jobs set status='succeeded',succeeded_at=clock_timestamp() where id=${jobId}`;
    return { before: await read(), oldClaim: null };
  }
  const writer = historicalWriter(tx, jobId, original.retry_at.toISOString());
  await writer.claim();
  switch (cohort) {
    case 'page':
      await writer.fail();
      break;
    case 'selected-remainder':
      await writer.page([createId(), createId()], true);
      break;
    case 'claimed':
      await writer.page([createId(), createId()], true);
      await writer.claim();
      break;
    case 'deleting':
      await writer.finishPages();
      break;
    case 'acknowledged':
      await writer.finishPages();
      await writer.acknowledge();
      break;
  }
  const before = await read();
  return { before, oldClaim: before.billing_cleanup?.claim ?? null };
}

function historicalWriter(tx: TransactionSQL, jobId: string, retryAt: string) {
  const now = async () =>
    (await tx`select clock_timestamp() as at`)[0]!.at.toISOString() as string;
  const head = { kind: 'page' as const, afterId: null };
  let value: HistoricalState = {
    kind: 'scanning',
    jobId,
    retryAt: retryAt,
    claim: null,
    turn: 'purchases',
    scans: {
      purchases: head,
      subscriptions: head,
      invoices: head,
      refunds: head,
    },
  };
  const persist = async () => {
    await tx`update privacy_jobs set billing_cleanup=${JSON.stringify(value)}::text::jsonb where id=${jobId}`;
  };
  const claim = async () => {
    await tx`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
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
  const page = async (ids: readonly string[], more = false) => {
    if (value.kind !== 'scanning') throw Error('Expected historical scanning');
    const [first, ...rest] = ids;
    const frame = first
      ? {
          kind: 'selected' as const,
          id: first,
          rest,
          lastId: ids.at(-1)!,
          more,
          detail:
            value.turn === 'invoices'
              ? { kind: 'invoice-payments' as const, afterId: null }
              : { kind: 'resource' as const },
        }
      : { kind: 'complete' as const };
    const scans = { ...value.scans, [value.turn]: frame };
    const index = lanes.indexOf(value.turn);
    // Select by cyclic order, independently of the original array's index.
    let next: HistoricalLane | null = null;
    for (let offset = 1; offset <= 4; offset++) {
      const candidate = lanes[(index + offset) % 4]!;
      if (scans[candidate].kind !== 'complete') {
        next = candidate;
        break;
      }
    }
    const retryAt = new Date(Date.parse(await now()) + 1000).toISOString();
    value = next
      ? { ...value, scans, turn: next, claim: null, retryAt }
      : { kind: 'deleting', jobId, retryAt, claim: null };
    await tx`update privacy_jobs set billing_cleanup=${JSON.stringify(value)}::text::jsonb,retry_at=${retryAt}::timestamptz where id=${jobId}`;
  };
  return {
    claim,
    page,
    async fail() {
      const retryAt = new Date(Date.parse(await now()) + 1000).toISOString();
      if (value.kind !== 'scanning') throw Error('Expected historical page');
      value = { ...value, turn: 'subscriptions', claim: null, retryAt };
      await tx`update privacy_jobs set billing_cleanup=${JSON.stringify(value)}::text::jsonb,retry_at=${retryAt}::timestamptz,attempts=attempts+1 where id=${jobId}`;
    },
    async finishPages() {
      for (let index = 0; index < 4; index++) {
        if (index > 0) await claim();
        await page([]);
      }
    },
    async acknowledge() {
      await claim();
      const at = await now();
      await tx`update privacy_jobs set status='succeeded',succeeded_at=${at}::timestamptz,billing_cleanup=${JSON.stringify({ kind: 'acknowledged', jobId, outcome: 'vendor-deleted', checkedAt: at, nextAt: new Date(Date.parse(at) + 86400000).toISOString() })}::text::jsonb where id=${jobId}`;
    },
  };
}
