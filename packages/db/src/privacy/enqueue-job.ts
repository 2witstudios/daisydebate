import { sql } from 'drizzle-orm';
import type { AuthorizationTransaction } from '../authorization';
import type { PrivacyVendor } from './planner';

/** Caller holds the canonical account fence and has proven a new erasure obligation. */
export async function enqueuePrivacyJob(
  tx: Pick<AuthorizationTransaction, 'execute'>,
  job: {
    readonly id: string;
    readonly subjectRef: string;
    readonly vendor: PrivacyVendor;
    readonly createdAt: string;
  },
) {
  await tx.execute(sql`insert into privacy_jobs
    (id, subject_ref, vendor, status, attempts, created_at, retry_at)
    values (${job.id}, ${job.subjectRef}, ${job.vendor}, 'pending', 0,
      ${job.createdAt}::timestamptz, ${job.createdAt}::timestamptz)
    on conflict (subject_ref, vendor) do update set id=excluded.id,
      status='pending', attempts=0, created_at=excluded.created_at,
      retry_at=excluded.retry_at, succeeded_at=null`);
}
