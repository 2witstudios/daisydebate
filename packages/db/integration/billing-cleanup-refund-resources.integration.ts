import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src/index';
import { withBillingRefunds } from './billing-refunds.test-support';
const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();
test('owned cleanup refund resources retain original money identity after the ordinary customer mapping is deleted', async () =>
  withBillingRefunds(
    async ({ fixture, pool, instanceId, userId, payment, refunds }) => {
      const reserve = pool.reserve.bind(pool);
      pool.reserve = async (options) => {
        const connection = await reserve(options);
        await connection`set role daisy_web`;
        return connection;
      };
      try {
        const admitted = await refunds.admit(userId, payment);
        if (!('action' in admitted)) throw Error('Controlled refund refused');
        await fixture.sql`delete from billing_customers where user_id=${userId}`;
        const [job] =
          await fixture.sql`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        const jobId = job!.id as string;
        const database = createDatabase({
            url: databaseUrl,
            client: pool,
            nextActorId: createId,
          }),
          cleanup = database.billingCleanup(instanceId);
        const claim = async () => {
          await fixture.sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
          await database.renewServiceInstance({ instanceId, role: 'web' });
          const c = await cleanup.claim(jobId);
          if (
            c.kind !== 'claimed' ||
            c.state.kind === 'acknowledged' ||
            !c.state.claim
          )
            throw Error('Missing resource claim');
          return { ...c, claimId: c.state.claim.id };
        };
        const deferOthers = async (count: number) => {
          for (let lane = 0; lane < count; lane++) {
            const c = await claim(),
              [clock] = await fixture.sql`select clock_timestamp() as at`;
            await cleanup.record(jobId, {
              kind: 'failure',
              claimId: c.claimId,
              work: c.work,
              retryAt: new Date(clock!.at.getTime() + 100).toISOString(),
            });
          }
        };
        await deferOthers(3);
        let c = await claim();
        const page = await cleanup.resources(jobId, c.claimId, c.work);
        if (page.kind !== 'page') throw Error('Missing refund page');
        await cleanup.record(jobId, {
          kind: 'page',
          claimId: c.claimId,
          work: c.work,
          ids: page.ids,
          more: page.more,
        });
        await deferOthers(4);
        c = await claim();
        const resource = await cleanup.resources(jobId, c.claimId, c.work);
        const stale = await cleanup.resources(jobId, createId(), c.work);
        const [mapping] =
          await fixture.sql`select count(*)::int as n from billing_customers where user_id=${userId}`;
        assert({
          given:
            'a closed account whose only customer routing is its retained original-charge action',
          should:
            'read the exact owned action without new money authority, refuse another claim and never reconstruct a customer',
          actual: [page, resource, stale, mapping!.n],
          expected: [
            { kind: 'page', ids: [admitted.action.id], more: false },
            { kind: 'refund', action: admitted.action },
            { kind: 'refuse' },
            0,
          ],
        });
      } finally {
        pool.reserve = reserve;
      }
    },
  ));
