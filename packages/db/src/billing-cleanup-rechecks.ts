import { asc, gt, sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import { billingCleanupSchema } from '@daisy/protocol/billing';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import { lockCleanupRecord } from './billing-cleanup-authority';
import { readDatabaseTime } from './database-clock';
import { privacyJobs } from './schema/privacy-jobs';
import { enqueuePrivacyJob } from './privacy/enqueue-job';

const batch = 32;
/** PRIMARY KEY keyset pages return at most33 rows; due classification stays inside that page. */
export function createBillingCleanupRechecks(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    rechecks(afterId?: string) {
      if (afterId !== undefined && !idSchema.safeParse(afterId).success)
        throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        const rows = await tx
          .select({
            id: privacyJobs.id,
            execution: sql<unknown>`case when vendor='stripe' and status='succeeded' then billing_cleanup else null end`,
          })
          .from(privacyJobs)
          .where(
            afterId === undefined ? undefined : gt(privacyJobs.id, afterId),
          )
          .orderBy(asc(privacyJobs.id))
          .limit(batch + 1);
        const now = (await readDatabaseTime(tx)).getTime(),
          page = rows.slice(0, batch);
        const eligible = page.flatMap((row) => {
          if (row.execution === null) return [];
          const parsed = billingCleanupSchema.safeParse(row.execution);
          if (
            !parsed.success ||
            parsed.data.kind !== 'acknowledged' ||
            parsed.data.jobId !== row.id
          )
            throw createAppError('INVARIANT');
          return Date.parse(parsed.data.nextAt) <= now
            ? [{ jobId: row.id }]
            : [];
        });
        return {
          rows: eligible,
          afterId: page.at(-1)?.id ?? null,
          exhausted: rows.length <= batch,
        };
      });
    },
    reopen(jobId: string) {
      return input.run(async (tx) => {
        const locked = await lockCleanupRecord(tx, jobId);
        if (
          !locked ||
          locked.row.status !== 'succeeded' ||
          locked.row.billingCleanup === null
        )
          return 'idle' as const;
        const state = billingCleanupSchema.parse(locked.row.billingCleanup);
        const now = (await readDatabaseTime(tx)).toISOString();
        if (
          state.kind !== 'acknowledged' ||
          state.jobId !== jobId ||
          Date.parse(state.nextAt) > Date.parse(now)
        )
          return 'idle' as const;
        await enqueuePrivacyJob(tx, {
          id: input.nextId(),
          subjectRef: locked.userId,
          vendor: 'stripe',
          createdAt: now,
        });
        return 'changed' as const;
      });
    },
  };
}
