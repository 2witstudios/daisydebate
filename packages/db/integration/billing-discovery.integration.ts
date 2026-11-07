import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { subscriptionGrants } from '@daisy/auth/authorization';
import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
import { createDatabase } from '../src/index';
import { lockAuthorizationActors } from '../src/authorization';
import { finishedOrBlockedBehind } from '../src/testing';
import { withHeldCommit } from './usage-ledger.test-support';
import { withBillingSynchronization } from './billing-synchronization.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('the public billing store recovers an early receipt after mapping and discovers missed-event work without an in-memory queue', async () =>
  withBillingSynchronization(
    async ({ fixture, pool, customerId, vendorCustomerId, paid }) => {
      const database = createDatabase({
        url: databaseUrl,
        client: pool,
        nextActorId: createId,
      });
      const instanceId = createId();
      const store = database.billingSynchronization(
        instanceId,
        subscriptionGrants,
      );
      const input = { mode: 'test' as const, limit: 1 };
      try {
        await assertRejects({
          given: 'an unregistered worker',
          should: 'refuse billing discovery',
          code: 'AUTHORIZATION',
          actual: () => store.customers(input),
        });
        await database.renewServiceInstance({ instanceId, role: 'web' });
        const [original] =
          await fixture.sql`select * from billing_customers where id=${customerId}`;
        await fixture.sql`delete from billing_customers where id=${customerId}`;
        const receipt = {
          eventId: `evt_${createId()}`,
          customerId: vendorCustomerId,
          mode: 'test' as const,
        };
        assert({
          given: 'a signed event before its verified local mapping is saved',
          should:
            'durably keep a pending receipt without treating it as linked authority',
          actual: [
            await database.receiveBillingReceipt(receipt),
            (await store.receipts(input)).rows,
          ],
          expected: ['pending', []],
        });
        await fixture.sql`insert into billing_customers(id,user_id,vendor_customer_id,mode,synchronization,created_at) values(${original.id},${original.user_id},${original.vendor_customer_id},${original.mode},${JSON.stringify(original.synchronization)}::text::jsonb,${original.created_at})`;
        const page = await store.receipts(input);
        const linked = page.rows[0]!;
        const received = await store.receive({
          eventId: linked.eventId,
          customerId: linked.customerId,
          mode: linked.mode,
        });
        const customers = await store.customers(input);
        const next = await store.customers({
          ...input,
          afterId: customers.afterId!,
        });
        const claim = (await store.claim(customerId))!;
        assert({
          given: 'mapping appears and a fresh worker reads the durable page',
          should:
            'link the original receipt, page bounded identities and apply payment once',
          actual: [
            page.rows.map((row) => row.eventId),
            page.exhausted,
            received,
            customers.rows,
            customers.exhausted,
            next.rows,
            next.exhausted,
            await store.apply(claim, paid),
          ],
          expected: [
            [receipt.eventId],
            false,
            'recorded',
            [{ customerId }],
            false,
            [],
            true,
            'applied',
          ],
        });
        const [clock] = await fixture.sql`select clock_timestamp() as now`;
        const observedAt = new Date(
          clock.now.getTime() - 600_000,
        ).toISOString();
        const nextAt = new Date(clock.now.getTime() - 300_000).toISOString();
        await fixture.sql`update billing_customers set synchronization=${JSON.stringify({ kind: 'settled', revision: claim.revision, observedAt, nextAt })}::text::jsonb where id=${customerId}`;
        const restarted = database.billingSynchronization(
          instanceId,
          subscriptionGrants,
        );
        assert({
          given:
            'no new event and a restarted reconciler after the polling deadline',
          should: 'rediscover and claim durable subscription work',
          actual: [
            (await restarted.customers(input)).rows,
            Boolean(await restarted.claim(customerId)),
            (await restarted.receipts(input)).rows,
          ],
          expected: [[{ customerId }], true, []],
        });
      } finally {
        await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      }
    },
  ));

test('a billing worker that loses service authority during an account lock wait rolls back all payment writes', async () =>
  withBillingSynchronization(
    async ({ fixture, pool, run, customerId, userId, actorId, paid }) => {
      const database = createDatabase({
        url: databaseUrl,
        client: pool,
        nextActorId: createId,
      });
      const instanceId = createId();
      const store = database.billingSynchronization(
        instanceId,
        subscriptionGrants,
      );
      await database.renewServiceInstance({ instanceId, role: 'web' });
      const claim = (await store.claim(customerId))!;
      const [before] =
        await fixture.sql`select synchronization from billing_customers where id=${customerId}`;
      try {
        await withHeldCommit(run, async (held) => {
          const holder = held.observe(
            held.run(async (tx) => {
              await lockAuthorizationActors(tx, [actorId], { maxActors: 1 });
            }),
          );
          const pid = await held.entered;
          const pending = held.observe(store.apply(claim, paid));
          try {
            assert({
              given:
                'a current worker with a verified payment waiting on the canonical account fence',
              should: 'reach the actual PostgreSQL lock',
              actual: await finishedOrBlockedBehind(pending, fixture.sql, pid, {
                now: performance.now,
                deadlineMs: 500,
              }),
              expected: 'blocked',
            });
            await fixture.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
          } finally {
            held.release();
          }
          await holder;
          await assertRejects({
            given: 'service authority expires while the operation is blocked',
            should: 'refuse completion under its final service fence',
            code: 'AUTHORIZATION',
            actual: () => pending,
          });
        });
        const [after] =
          await fixture.sql`select synchronization from billing_customers where id=${customerId}`;
        const [facts] =
          await fixture.sql`select evidence->'settlement'->>'kind' as kind,(select count(*)::int from account_entitlement_grants where user_id=${userId}) as grants from billing_subscriptions where user_id=${userId}`;
        assert({
          given: 'the refused transaction',
          should:
            'retain exactly its original claim, unpaid facts and zero grants',
          actual: [after, facts],
          expected: [before, { kind: 'unpaid', grants: 0 }],
        });
      } finally {
        await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      }
    },
  ));
