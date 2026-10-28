import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { privacyVendors, type PrivacyVendor } from './planner';

/** A committed-pool port. Never pass the local erasure transaction here. */
type Execute = Pick<BunSQLDatabase, 'execute'>;

/** One due pending vendor deletion job, read for delivery. */
export type DuePrivacyJob = {
  readonly id: string;
  readonly vendor: PrivacyVendor;
};

const MAX_DUE_BATCH = 128;

/**
 * Every pending vendor deletion job due at `now`, oldest first, bounded
 * (ADR 0087): the scheduled worker reads a batch, then delivers each row
 * through `deliverPrivacyJob`, which owns claiming, retry and success.
 */
export async function duePrivacyJobs(
  database: Execute,
  input: { readonly now: string; readonly limit: number },
): Promise<readonly DuePrivacyJob[]> {
  const due = new Date(input.now);
  if (
    !Number.isFinite(due.getTime()) ||
    due.toISOString() !== input.now ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_DUE_BATCH
  )
    throw createAppError('VALIDATION');
  const read = (await database.execute(sql`select id, vendor from privacy_jobs
    where status = 'pending' and retry_at <= ${input.now}::timestamptz
    order by retry_at, id limit ${input.limit}`)) as unknown as {
    id: string;
    vendor: PrivacyVendor;
  }[];
  // A row the database checks admit is malformed: refuse before delivery.
  if (
    !read.every(
      (row) =>
        idSchema.safeParse(row.id).success &&
        privacyVendors.some((known) => known === row.vendor),
    )
  )
    throw createAppError('VALIDATION');
  return read;
}

export async function deliverPrivacyJob(
  database: Pick<BunSQLDatabase, 'execute'>,
  input: {
    readonly jobId: string;
    readonly vendor: PrivacyVendor;
    readonly now: string;
    readonly retryAt: string;
  },
  port: {
    /** Idempotent subject deletion: concurrent attempts may repeat it. */
    readonly erase: (subjectRef: string) => Promise<void>;
  },
): Promise<'idle' | 'retry' | 'succeeded'> {
  checkJobInput(input);
  const rows =
    await database.execute(sql`select subject_ref as "subjectRef" from privacy_jobs
    where id = ${input.jobId} and vendor = ${input.vendor} and status = 'pending'
    and retry_at <= ${input.now}::timestamptz`);
  const row = (rows as unknown as { subjectRef: string }[])[0];
  if (!row) return 'idle';
  if (!idSchema.safeParse(row.subjectRef).success)
    throw createAppError('VALIDATION');
  try {
    await port.erase(row.subjectRef);
  } catch {
    // Vendor failures are deliberately absent from durable fields/telemetry.
    await database.execute(sql`update privacy_jobs set attempts = attempts + 1,
      retry_at = ${input.retryAt}::timestamptz
      where id = ${input.jobId} and vendor = ${input.vendor} and status = 'pending'`);
    return 'retry';
  }
  await database.execute(sql`update privacy_jobs set status = 'succeeded', attempts = attempts + 1,
    succeeded_at = ${input.now}::timestamptz
    where id = ${input.jobId} and vendor = ${input.vendor} and status = 'pending'`);
  return 'succeeded';
}

function checkJobInput(input: {
  jobId: string;
  vendor: PrivacyVendor;
  now: string;
  retryAt: string;
}) {
  const now = new Date(input.now);
  const retryAt = new Date(input.retryAt);
  if (
    !idSchema.safeParse(input.jobId).success ||
    !privacyVendors.includes(input.vendor) ||
    !Number.isFinite(now.getTime()) ||
    now.toISOString() !== input.now ||
    !Number.isFinite(retryAt.getTime()) ||
    retryAt.toISOString() !== input.retryAt ||
    retryAt <= now
  )
    throw createAppError('VALIDATION');
}
