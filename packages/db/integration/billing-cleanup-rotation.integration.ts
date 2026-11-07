import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src/index';
import { withBillingRefunds } from './billing-refunds.test-support';
const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();

test('new financial facts rotate only Stripe execution and stale progress cannot reschedule the replacement job', async () =>
  withBillingRefunds(
    async ({ fixture, pool, instanceId, userId, payment, refunds }) => {
      const [old] =
        await fixture.sql`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
      const cleanup = createDatabase({
        url: databaseUrl,
        client: pool,
        nextActorId: createId,
      }).billingCleanup(instanceId);
      const first = await cleanup.claim(old!.id);
      if (
        first.kind !== 'claimed' ||
        first.state.kind === 'acknowledged' ||
        !first.state.claim
      )
        throw Error('Rotation fixture claim refused');
      const admitted = await refunds.admit(userId, payment);
      if (!('action' in admitted))
        throw Error('Refund fixture admission refused');
      const [next] =
        await fixture.sql`select id,status,attempts,retry_at,billing_cleanup from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
      const stale = await cleanup.record(old!.id, {
        kind: 'page',
        claimId: first.state.claim.id,
        work: first.work,
        ids: [],
        more: false,
      });
      const [unchanged] =
        await fixture.sql`select id,status,attempts,retry_at,billing_cleanup from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
      await fixture.sql`delete from billing_customers where user_id=${userId}`;
      const current = await cleanup.claim(next!.id);
      if (
        current.kind !== 'claimed' ||
        current.state.kind === 'acknowledged' ||
        !current.state.claim
      )
        throw Error('Missing replacement claim');
      const falseAbsence = await cleanup.record(next!.id, {
        kind: 'no-effects',
        claimId: current.state.claim.id,
        work: current.work,
      });
      const [financial] =
        await fixture.sql`select id,vendor_charge_id,period_starts_at,period_ends_at,state from billing_refund_actions where user_id=${userId}`;
      assert({
        given:
          'a late admitted original-charge refund and deleted ordinary customer mapping',
        should:
          'clear only old execution authority, preserve routing/money facts, and refuse absent-mapping completion',
        actual: [
          next!.id !== old!.id,
          next!.billing_cleanup,
          stale,
          unchanged,
          current.facts.effects,
          current.facts.route,
          falseAbsence,
          financial!.id,
          financial!.vendor_charge_id,
          financial!.state,
        ],
        expected: [
          true,
          null,
          'idle',
          next,
          {
            mappedCustomers: 0,
            possiblePurchases: 0,
            retainedFinancialRoutes: 1,
            owedFinancialEffects: true,
          },
          { kind: 'owned', mode: 'test', customerId: payment.customerId },
          'idle',
          admitted.action.id,
          payment.chargeId,
          { kind: 'ready' },
        ],
      });
    },
  ));

test('durable progress preserves failure attempts and uses its fixed due time rather than old backoff', async () =>
  withBillingRefunds(async ({ fixture, pool, instanceId, userId }) => {
    const [job] =
      await fixture.sql`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
    const database = createDatabase({
      url: databaseUrl,
      client: pool,
      nextActorId: createId,
    });
    const cleanup = database.billingCleanup(instanceId);
    for (let attempt = 0; attempt < 8; attempt++) {
      await fixture.sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${job!.id}`;
      await database.renewServiceInstance({ instanceId, role: 'web' });
      const failed = await cleanup.claim(job!.id);
      if (
        failed.kind !== 'claimed' ||
        failed.state.kind === 'acknowledged' ||
        !failed.state.claim
      )
        throw Error('Missing prior failed attempt');
      const [clock] = await fixture.sql`select clock_timestamp() as at`;
      const result = await cleanup.record(job!.id, {
        kind: 'failure',
        claimId: failed.state.claim.id,
        work: failed.work,
        retryAt: new Date(clock!.at.getTime() + 250).toISOString(),
      });
      if (result !== 'failure') throw Error('Prior failure was not consumed');
    }
    await fixture.sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${job!.id}`;
    const current = await cleanup.claim(job!.id);
    if (
      current.kind !== 'claimed' ||
      current.state.kind === 'acknowledged' ||
      !current.state.claim
    )
      throw Error('Progress fixture claim refused');
    const result = await cleanup.record(job!.id, {
      kind: 'page',
      claimId: current.state.claim.id,
      work: current.work,
      ids: [],
      more: false,
    });
    const [after] =
      await fixture.sql`select status,attempts,billing_cleanup->>'turn' as turn,
    retry_at>clock_timestamp() and retry_at<=clock_timestamp()+interval '1 second' as fixed_due,
    billing_cleanup->'claim'='null'::jsonb as consumed from privacy_jobs where id=${job!.id}`;
    assert({
      given:
        'actual cleanup progress on an account with eight prior failed attempts',
      should:
        'advance one durable lane and yield on fixed due without another vendor-failure attempt',
      actual: [result, after],
      expected: [
        'progress',
        {
          status: 'pending',
          attempts: 8,
          turn: 'observations',
          fixed_due: true,
          consumed: true,
        },
      ],
    });
  }));
