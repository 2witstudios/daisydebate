import type { TransactionSQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';

/** Exact immutable112 test oracle, never a runtime compatibility parser. */
export const startHistoricalInvoicePassV2 = (
  jobId: string,
  retryAt: string,
) => ({
  version: 2,
  kind: 'scanning' as const,
  jobId,
  retryAt,
  claim: null,
  turn: 'purchases',
  invoiceDebt: { kind: 'none' },
  scans: {
    purchases: { kind: 'page' as const, afterId: null },
    subscriptions: { kind: 'page' as const, afterId: null },
    invoices: { kind: 'page' as const, afterId: null },
    refunds: { kind: 'page' as const, afterId: null },
    observations: { kind: 'page' as const, afterId: null },
  },
});

export async function claimHistoricalInvoicePassV2(
  tx: TransactionSQL,
  jobId: string,
) {
  await tx`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.005) from privacy_jobs where id=${jobId}`;
  const [row] =
    await tx`select billing_cleanup,retry_at,clock_timestamp() as at from privacy_jobs where id=${jobId} for update`;
  const state =
    row!.billing_cleanup ??
    startHistoricalInvoicePassV2(jobId, row!.retry_at.toISOString());
  if (state.version !== 2 || state.kind === 'acknowledged')
    throw Error('Missing historical112 active execution');
  const at = row!.at.toISOString();
  const claimed = {
    ...state,
    claim: {
      id: createId(),
      claimedAt: at,
      expiresAt: new Date(Date.parse(at) + 30000).toISOString(),
    },
  };
  await tx`update privacy_jobs set billing_cleanup=${JSON.stringify(claimed)}::text::jsonb where id=${jobId}`;
  return claimed;
}
