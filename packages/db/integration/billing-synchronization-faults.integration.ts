import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { subscriptionGrants } from '@daisy/auth/authorization';
import { createId } from '@paralleldrive/cuid2';
import { createBillingSynchronization } from '../src/billing-synchronization';
import { finishedOrBlockedBehind } from '../src/testing';
import { withBillingSynchronization } from './billing-synchronization.test-support';
import { loseTransactionCommitReply } from './bounded-transaction.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('lost webhook COMMIT reply recovers the durable receipt without invalidating a claim', async () =>
  withBillingSynchronization(
    async ({ fixture, pool, customerId, vendorCustomerId, inbox, store }) => {
      const receipt = {
        eventId: `evt_${createId()}`,
        customerId: vendorCustomerId,
        mode: 'test' as const,
      };
      const restore = loseTransactionCommitReply(pool, 2);
      try {
        await assertRejects({
          given: 'PostgreSQL commits the receipt but its reply is lost',
          should: 'report an uncertain result',
          code: 'INFRASTRUCTURE',
          actual: () => inbox(receipt),
        });
      } finally {
        restore();
      }
      const claim = await store.claim(customerId);
      const [before] =
        await fixture.sql`select synchronization from billing_customers where id=${customerId}`;
      const result = await inbox(receipt);
      const [after] =
        await fixture.sql`select synchronization from billing_customers where id=${customerId}`;
      assert({
        given:
          'delivery retries after the lost reply and another worker already claimed it',
        should: 'reuse the committed receipt and retain that exact claim',
        actual: [result, Boolean(claim), after],
        expected: ['duplicate', true, before],
      });
    },
  ));

test('a terminated backend rolls back evidence, grants and completion together', async () =>
  withBillingSynchronization(
    async ({ fixture, run, customerId, userId, store, paid }) => {
      const claim = (await store.claim(customerId))!;
      const [before] =
        await fixture.sql`select synchronization from billing_customers where id=${customerId}`;
      let terminated = false;
      const crashing = createBillingSynchronization({
        nextId: createId,
        grants: subscriptionGrants,
        run: (callback, options) =>
          run(async (...args) => {
            const result = await callback(...args);
            const { writer } = args[2];
            const [killed] =
              await fixture.sql`select pg_terminate_backend(pid,500) as stopped from pg_stat_activity where pid=${writer.pid} and backend_start::text=${writer.backendStart}`;
            terminated = killed?.stopped === true;
            if (!killed?.stopped)
              throw Error('The owned writer was not terminated');
            return result;
          }, options),
      });
      await assertRejects({
        given:
          'the owned writer dies after every billing write but before commit',
        should: 'fail the operation',
        code: 'INFRASTRUCTURE',
        actual: () => crashing.apply(claim, paid),
      });
      const [after] =
        await fixture.sql`select synchronization from billing_customers where id=${customerId}`;
      const [evidence] =
        await fixture.sql`select evidence->'settlement'->>'kind' as kind from billing_subscriptions where user_id=${userId}`;
      const [grants] =
        await fixture.sql`select count(*)::integer as n from account_entitlement_grants where user_id=${userId}`;
      assert({
        given: 'the actual backend is gone',
        should: 'retain the original claim, unpaid evidence and zero grants',
        actual: [terminated, after, evidence.kind, grants.n],
        expected: [true, before, 'unpaid', 0],
      });
      assert({
        given: 'a fresh bounded transaction with the same still-valid claim',
        should: 'recover and atomically apply payment',
        actual: await store.apply(claim, paid),
        expected: 'applied',
      });
    },
  ));

test('subscription application samples time after an account lock wait crossing claim expiry', async () =>
  withBillingSynchronization(
    async ({ fixture, customerId, userId, store, paid }) => {
      const claim = (await store.claim(customerId))!;
      // A valid short lease makes the real lock crossing bounded without changing production policy.
      await fixture.sql`update billing_customers set synchronization=jsonb_set(synchronization,'{claim,expiresAt}',to_jsonb(to_char((clock_timestamp()+interval '700 milliseconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where id=${customerId}`;
      const [before] =
        await fixture.sql`select synchronization from billing_customers where id=${customerId}`;
      const holder = await fixture.sql.reserve();
      let pending: ReturnType<typeof store.apply> | undefined;
      let observed: Promise<unknown> | undefined;
      try {
        await holder`begin`;
        await holder`select id from users where id=${userId} for update`;
        const [backend] = await holder`select pg_backend_pid() as pid`;
        pending = store.apply(claim, paid);
        observed = Promise.allSettled([pending]);
        const ordering = await finishedOrBlockedBehind(
          pending,
          fixture.sql,
          Number(backend.pid),
          { now: performance.now, deadlineMs: 300 },
        );
        const [edge] =
          await holder`select clock_timestamp()<(synchronization->'claim'->>'expiresAt')::timestamptz as before from billing_customers where id=${customerId}`;
        assert({
          given: 'the claim completion waiting for current account authority',
          should: 'block while its lease is still valid',
          actual: [ordering, edge.before],
          expected: ['blocked', true],
        });
        await holder`select pg_sleep(greatest(0,extract(epoch from (synchronization->'claim'->>'expiresAt')::timestamptz-clock_timestamp()))+0.01) from billing_customers where id=${customerId}`;
        await holder`commit`;
        await observed;
        const [after] =
          await fixture.sql`select synchronization from billing_customers where id=${customerId}`;
        const [grants] =
          await fixture.sql`select count(*)::integer as n from account_entitlement_grants where user_id=${userId}`;
        assert({
          given: 'the lease expired during the actual lock wait',
          should: 'refuse without changing evidence, grants or claim state',
          actual: [await pending, after, grants.n],
          expected: ['stale', before, 0],
        });
        const replacement = (await store.claim(customerId))!;
        assert({
          given: 'recovery after the expired claim',
          should: 'admit a new generation and refuse the old worker',
          actual: [
            replacement.revision > claim.revision,
            await store.apply(claim, paid),
            await store.apply(replacement, paid),
          ],
          expected: [true, 'stale', 'applied'],
        });
      } finally {
        await holder`rollback`;
        holder.release();
        await observed;
      }
    },
  ));
