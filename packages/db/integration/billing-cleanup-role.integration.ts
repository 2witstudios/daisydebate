import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src/index';
import { sqlStateOf } from './constraint-helpers';
import { withBillingRefunds } from './billing-refunds.test-support';
const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();

test('runtime Stripe cleanup cannot rewrite job origin, report cursorless progress or skip selecting a page resource', async () =>
  withBillingRefunds(async ({ fixture, pool, instanceId, userId }) => {
    const [job] =
      await fixture.sql`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
    const cleanup = createDatabase({
      url: databaseUrl,
      client: pool,
      nextActorId: createId,
    }).billingCleanup(instanceId);
    const claim = await cleanup.claim(job!.id);
    if (claim.kind !== 'claimed') throw Error('Role fixture claim refused');
    const [before] =
      await fixture.sql`select created_at,retry_at,billing_cleanup from privacy_jobs where id=${job!.id}`;
    const connection = await fixture.sql.reserve();
    const codes = [];
    try {
      await connection`set role daisy_web`;
      await connection`begin`;
      const mutations = [
        () =>
          connection`update privacy_jobs set created_at=created_at-interval '1 second' where id=${job!.id}`,
        () => connection`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp())+interval '1 second' as due)
        update privacy_jobs set billing_cleanup=jsonb_set(jsonb_set(jsonb_set(billing_cleanup,'{turn}','"subscriptions"'),'{claim}','null'),'{retryAt}',to_jsonb(to_char(sampled.due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),retry_at=sampled.due from sampled where id=${job!.id}`,
        () => connection`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp())+interval '1 second' as due)
        update privacy_jobs set billing_cleanup=jsonb_set(jsonb_set(jsonb_set(jsonb_set(billing_cleanup,'{turn}','"subscriptions"'),'{claim}','null'),'{scans,purchases,afterId}',to_jsonb(${createId()}::text)),'{retryAt}',to_jsonb(to_char(sampled.due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),retry_at=sampled.due from sampled where id=${job!.id}`,
      ];
      for (const mutation of mutations) {
        await connection`savepoint owned_cleanup_probe`;
        codes.push(await sqlStateOf(mutation));
        await connection`rollback to savepoint owned_cleanup_probe`;
        await connection`release savepoint owned_cleanup_probe`;
      }
    } finally {
      await connection`rollback`;
      await connection`reset role`;
      connection.release();
    }
    const [after] =
      await fixture.sql`select created_at,retry_at,billing_cleanup from privacy_jobs where id=${job!.id}`;
    assert({
      given:
        'actual daisy_web mutations of job creation, turn-only refresh and direct page-cursor skipping',
      should:
        'reject each with the intended guard and retain all original state',
      actual: [codes, after],
      expected: [['23514', '23514', '23514'], before],
    });
  }));
