import { retriedJobStatuses } from '../schema/columns';
import { listedWord } from '../lifecycle-sql';
import { sql } from 'drizzle-orm';
import type { PrivacyVendor } from './planner';
import type { Tx } from '../tx';
import { run } from '../raw-rows';

/** Caller holds the canonical account fence and has proven a new erasure obligation. */
export async function enqueuePrivacyJob(
  tx: Tx,
  job: {
    readonly id: string;
    readonly subjectRef: string;
    readonly vendor: PrivacyVendor;
    readonly createdAt: string;
  },
) {
  await run(
    tx,
    sql`insert into privacy_jobs
    (id, subject_ref, vendor, status, attempts, created_at, retry_at)
    values (${job.id}, ${job.subjectRef}, ${job.vendor}, ${listedWord(retriedJobStatuses, 'pending')}, 0,
      ${job.createdAt}::timestamptz, ${job.createdAt}::timestamptz)
    on conflict (subject_ref, vendor) do update set id=excluded.id,
      status=${listedWord(retriedJobStatuses, 'pending')}, attempts=0, created_at=excluded.created_at,
      retry_at=excluded.retry_at, succeeded_at=null`,
  );
}
