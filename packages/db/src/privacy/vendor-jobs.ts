import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { retriedJob } from '../retried-job';
import { privacyJobs } from '../schema/privacy-jobs';
import { privacyVendors, type PrivacyVendor } from './planner';

const vendorJob = retriedJob(privacyJobs);

/** A committed-pool port. Never pass the local erasure transaction here. */
type Execute = Pick<BunSQLDatabase, 'execute'>;

/** One due pending vendor deletion job, read for delivery. */
export type DuePrivacyJob = {
  readonly id: string;
  readonly vendor: PrivacyVendor;
  readonly attempts: number;
};

const MAX_DUE_BATCH = 128;

/**
 * Every pending vendor deletion job due at `now`, oldest first, bounded
 * (ADR 0087): the scheduled worker reads a batch, then delivers each row
 * through `deliverPrivacyJob`, which owns claiming, retry and success.
 */
export async function duePrivacyJobs(
  database: Execute,
  input: {
    readonly now: string;
    readonly limit: number;
    readonly vendors?: readonly PrivacyVendor[];
  },
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
  const scope = vendorScope(input.vendors);
  const read =
    (await database.execute(sql`select id, vendor, attempts from privacy_jobs
    where status = 'pending' and retry_at <= ${input.now}::timestamptz ${scope}
    order by retry_at, id limit ${input.limit}`)) as unknown as DuePrivacyJob[];
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

/**
 * Jobs not yet delivered, in backoff or past the batch: an unpaid obligation
 * that a run must not report as healthy (ISSUE-1007).
 */
export async function owedPrivacyJobs(
  database: Execute,
  input: { readonly vendors?: readonly PrivacyVendor[] } = {},
): Promise<number> {
  const scope = vendorScope(input.vendors);
  const rows = (await database.execute(sql`select count(*)::int as owed
    from privacy_jobs
    where status = 'pending' ${scope}`)) as unknown as {
    owed: number;
  }[];
  return rows[0]?.owed ?? 0;
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
    await database.execute(sql`select subject_ref as "subjectRef", attempts from privacy_jobs
    where id = ${input.jobId} and vendor = ${input.vendor} and status = 'pending'
    and retry_at <= ${input.now}::timestamptz`);
  const row = (
    rows as unknown as { subjectRef: string; attempts: number }[]
  )[0];
  if (!row) return 'idle';
  if (!idSchema.safeParse(row.subjectRef).success)
    throw createAppError('VALIDATION');
  const job = sql`id = ${input.jobId} and vendor = ${input.vendor}`;
  try {
    await port.erase(row.subjectRef);
  } catch {
    // Vendor failures are deliberately absent from durable fields/telemetry.
    return (await vendorJob.failed(database, job, {
      read: row.attempts,
      retryAt: input.retryAt,
    }))
      ? 'retry'
      : 'idle';
  }
  return (await vendorJob.succeeded(database, job, {
    read: row.attempts,
    now: input.now,
  }))
    ? 'succeeded'
    : 'idle';
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

function vendorScope(vendors: readonly PrivacyVendor[] | undefined) {
  if (vendors === undefined) return sql``;
  if (
    vendors.length > privacyVendors.length ||
    new Set(vendors).size !== vendors.length ||
    vendors.some((value) => !privacyVendors.includes(value))
  )
    throw createAppError('VALIDATION');
  return vendors.length
    ? sql`and vendor in (${sql.join(
        vendors.map((value) => sql`${value}`),
        sql`, `,
      )})`
    : sql`and false`;
}
