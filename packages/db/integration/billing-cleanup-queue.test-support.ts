import { assert } from 'riteway/bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { duePrivacyJobs, owedPrivacyJobs } from '../src/privacy/vendor-jobs';

export async function proveQueueIndex(
  tx: import('bun').TransactionSQL,
  jobId: string,
  otherId: string,
) {
  const [index] =
    await tx`select current_user as role,am.amname,idx.indisunique,idx.indisvalid,
    pg_get_indexdef(idx.indexrelid,1,true) as first,pg_get_indexdef(idx.indexrelid,2,true) as second,pg_get_indexdef(idx.indexrelid,3,true) as third,
    pg_get_expr(idx.indpred,idx.indrelid) as predicate from pg_index idx join pg_class rel on rel.oid=idx.indexrelid join pg_am am on am.oid=rel.relam
    where idx.indexrelid='public.privacy_jobs_pending_vendor_due_idx'::regclass`;
  const [time] = await tx`select clock_timestamp() as at`;
  const database = drizzle({ client: tx });
  const stripe = await duePrivacyJobs(database, {
    now: time!.at.toISOString(),
    limit: 3,
    vendors: ['stripe'],
  });
  const generic = await duePrivacyJobs(database, {
    now: time!.at.toISOString(),
    limit: 3,
    vendors: ['posthog'],
  });
  assert({
    given:
      'actual daisy_web SELECT with one pending Stripe and separate generic vendor job',
    should:
      'expose exactly the nonunique pending vendor/due/id btree and isolate Stripe/default-vendor admission and owed counts',
    actual: {
      role: index!.role,
      method: index!.amname,
      unique: index!.indisunique,
      valid: index!.indisvalid,
      keys: [index!.first, index!.second, index!.third],
      pending: index!.predicate.includes("status = 'pending'"),
      stripe: stripe.map((row) => [row.id, row.vendor]),
      generic: generic.map((row) => [row.id, row.vendor]),
      empty: await duePrivacyJobs(database, {
        now: time!.at.toISOString(),
        limit: 3,
        vendors: [],
      }),
      stripeOwed: await owedPrivacyJobs(database, { vendors: ['stripe'] }),
      genericOwed: await owedPrivacyJobs(database, { vendors: ['posthog'] }),
    },
    expected: {
      role: 'daisy_web',
      method: 'btree',
      unique: false,
      valid: true,
      keys: ['vendor', 'retry_at', 'id'],
      pending: true,
      stripe: [[jobId, 'stripe']],
      generic: [[otherId, 'posthog']],
      empty: [],
      stripeOwed: 1,
      genericOwed: 1,
    },
  });
  const normal =
    await tx`explain(costs off) select id,vendor,attempts from privacy_jobs where vendor='stripe' and status='pending' and retry_at <= '2026-11-10'::timestamptz order by retry_at,id limit 3`;
  const artifact = process.env.BILLING_COVERAGE_PLAN_ARTIFACT;
  if (artifact)
    await Bun.write(
      artifact,
      JSON.stringify({
        normal: normal
          .map((row: { readonly 'QUERY PLAN': string }) => row['QUERY PLAN'])
          .join('\n'),
        plannerSettings: 'default',
        indexUseNotRequiredForTinyFixture: true,
        performanceAcceptance: false,
      }) + '\n',
    );
}
