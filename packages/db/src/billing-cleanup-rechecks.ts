import { and, asc, desc, gt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { billingCleanupSchema } from '@daisy/protocol/billing';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import { lockCleanupRecord } from './billing-cleanup-authority';
import { readDatabaseTime } from './database-clock';
import { privacyJobs } from './schema/privacy-jobs';
import { enqueuePrivacyJob } from './privacy/enqueue-job';

const batch = 32;
const passSchema = z
  .strictObject({ afterId: idSchema, throughId: idSchema })
  .refine((pass) => pass.afterId < pass.throughId);
type RecheckPass = z.infer<typeof passSchema>;
/** PRIMARY KEY keyset pages return at most33 rows; due classification stays inside that page. */
export function createBillingCleanupRechecks(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    rechecks(pass?: RecheckPass) {
      if (pass !== undefined && !passSchema.safeParse(pass).success)
        throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        // One indexed maximum fixes this traversal's upper boundary. New higher
        // IDs belong to the next pass, so tail growth cannot postpone its head.
        const throughId =
          pass?.throughId ??
          (
            await tx
              .select({ id: privacyJobs.id })
              .from(privacyJobs)
              .orderBy(desc(privacyJobs.id))
              .limit(1)
          )[0]?.id;
        if (throughId === undefined) return { rows: [], next: null };
        const rows = await tx
          .select({
            id: privacyJobs.id,
            execution: sql<unknown>`case when vendor='stripe' and status='succeeded' then billing_cleanup else null end`,
          })
          .from(privacyJobs)
          .where(
            and(
              lte(privacyJobs.id, throughId),
              pass === undefined ? undefined : gt(privacyJobs.id, pass.afterId),
            ),
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
          next:
            rows.length > batch
              ? { afterId: page.at(-1)!.id, throughId }
              : null,
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
