import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { completeControlledStripeCleanup } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { withSql, testDatabaseUrl } from './fixtures';
import { createRefundReconciliation } from '../src/features/billing/refund-reconciliation';
import { createRefundVendor } from '../src/features/billing/refund-vendor';
requireTestServices(process.env);
setupRitewayBun();

test(
  'action-owned refund worker reopens late financial obligations after customer deletion and prior cleanup acknowledgement',
  async () =>
    withSql(async (owner) => {
      const userId = createId(),
        actorId = createId(),
        instanceId = createId(),
        customerId = createId(),
        customer = `cus_${customerId}`,
        charge = `ch_${createId()}`,
        refundId = `re_${createId()}`;
      const pool = new SQL(testDatabaseUrl, { max: 4 });
      const reserve = pool.reserve.bind(pool),
        roles = new Set<string>();
      pool.reserve = async (options) => {
        const connection = await reserve(options);
        await connection`set role daisy_web`;
        const [role] = await connection`select current_user as role`;
        roles.add(role!.role);
        return connection;
      };
      const database = createDatabase({
        url: testDatabaseUrl,
        client: pool,
        nextActorId: createId,
      });
      const [clock] = await owner`select clock_timestamp() as at`;
      const at = clock!.at as Date,
        closed = new Date(at.getTime() - 2000);
      let instant = at.toISOString(),
        status: 'succeeded' | 'failed' | 'requires_action' = 'succeeded';
      const calls: (readonly unknown[])[] = [],
        failures: unknown[] = [];
      try {
        await owner`insert into users(id,username,created_at,deleted_at) values(${userId},${userId},${new Date(at.getTime() - 60000)},${closed})`;
        await owner`insert into actors(id,kind,user_id) values(${actorId},'human',${userId})`;
        await owner`insert into billing_customers(id,user_id,vendor_customer_id,mode,created_at,closed_at,synchronization)
   values(${customerId},${userId},${customer},'test',${new Date(at.getTime() - 60000)},${closed},${JSON.stringify({ kind: 'settled', revision: 1, observedAt: instant, nextAt: instant })}::text::jsonb)`;
        await database.renewServiceInstance({ instanceId, role: 'web' });
        const store = database.billingRefunds(instanceId);
        const admitted = await store.admit(userId, {
          mode: 'test',
          customerId: customer,
          chargeId: charge,
          invoiceId: `in_${createId()}`,
          vendorSubscriptionId: `sub_${createId()}`,
          amountMinor: 1000,
          currency: 'usd',
          paidAtSeconds: Math.floor(at.getTime() / 1000),
          period: {
            startsAt: new Date(at.getTime() - 86400000).toISOString(),
            endsAt: new Date(at.getTime() + 30 * 86400000).toISOString(),
          },
        });
        if (!('action' in admitted))
          throw Error('Controlled payment admission refused');
        const actionId = admitted.action.id;
        const refund = () => ({
          object: 'refund',
          id: refundId,
          charge,
          customer,
          amount: 1000,
          currency: 'usd',
          status,
          metadata: { daisy_refund_action_id: actionId },
        });
        const vendor = createRefundVendor({
          mode: 'test',
          clock: { now: () => instant },
          port: {
            create: async (parameters, key) => {
              calls.push(['create', parameters, key]);
              return refund();
            },
            retrieve: async (id) => {
              calls.push(['retrieve', id]);
              return refund();
            },
            list: async () => {
              throw Error('Unexpected discovery');
            },
          },
        });
        const worker = createRefundReconciliation({
          mode: 'test',
          vendor,
          failed: (error, stage) => failures.push([error, stage]),
          store: {
            ...store,
            claim: async (id) => {
              const c = await store.claim(id);
              if (c?.action.claim) instant = c.action.claim.claimedAt;
              return c;
            },
          },
        });
        await worker.run();
        const [succeeded] =
          await owner`select id,state->>'refundId' as refund,state->>'status' as status from billing_refund_actions where id=${actionId}`;
        // Controlled retained-history fixture: a prior cleanup acknowledged before a later bank return.
        // This is not genuine Stripe cancellation/customer-deletion lifecycle proof.
        await completeControlledStripeCleanup({
          owner,
          database,
          userId,
          instanceId,
        });
        const [ack] =
          await owner`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        await owner`delete from billing_customers where user_id=${userId}`;
        status = 'failed';
        await database.renewServiceInstance({ instanceId, role: 'web' });
        await worker.run();
        const [late] =
          await owner`select state->>'refundId' as refund,state->>'status' as status from billing_refund_actions where id=${actionId}`;
        const [reopened] =
          await owner`select id,status from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        status = 'requires_action';
        await database.renewServiceInstance({ instanceId, role: 'web' });
        await worker.run();
        const [current] =
          await owner`select id,vendor_charge_id,amount_minor,state->>'refundId' as refund,state->>'status' as status from billing_refund_actions where id=${actionId}`;
        const [effects] =
          await owner`select (select count(*)::int from billing_customers where user_id=${userId}) as customers,(select count(*)::int from account_entitlement_grants where user_id=${userId}) as grants`;
        assert({
          given:
            'real current daisy_web persistence plus controlled Stripe transport, retained original charge and a deleted ordinary mapping',
          should:
            'independently re-read the same refund after acknowledgement, reopen failed/action-required cleanup and create no second money action or access',
          actual: [
            Array.from(roles),
            succeeded,
            late,
            reopened!.id !== ack!.id,
            reopened!.status,
            current,
            effects,
            calls.map((call) => call.slice(0, 2)),
            calls[0]?.[2],
            failures,
          ],
          expected: [
            ['daisy_web'],
            { id: actionId, refund: refundId, status: 'succeeded' },
            { refund: refundId, status: 'failed' },
            true,
            'pending',
            {
              id: actionId,
              vendor_charge_id: charge,
              amount_minor: '1000',
              refund: refundId,
              status: 'requires_action',
            },
            { customers: 0, grants: 0 },
            [
              [
                'create',
                {
                  charge,
                  amount: 1000,
                  metadata: { daisy_refund_action_id: actionId },
                },
              ],
              ['retrieve', refundId],
              ['retrieve', refundId],
            ],
            `daisy-closure-refund:${actionId}`,
            [],
          ],
        });
      } finally {
        pool.reserve = reserve;
        await pool.close({ timeout: 0 });
        await owner`delete from service_instances where instance_id=${instanceId}`;
        await owner`delete from privacy_jobs where subject_ref=${userId}`;
        await owner`delete from billing_refund_actions where user_id=${userId}`;
        await owner`delete from billing_customers where user_id=${userId}`;
        await owner`delete from actors where id=${actorId}`;
        await owner`delete from users where id=${userId}`;
      }
    }),
  // The expanded typed fixture crosses at least six mandatory one-second progress deadlines.
  // This budget covers that journey; product claim, service and retry deadlines are unchanged.
  15000,
);
