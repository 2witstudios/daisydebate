import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { createBillingPurchases } from '../src/billing-purchase-store';
import { loseTransactionCommitReply } from './bounded-transaction.test-support';
import { flagCommand } from './flags.test-support';
import { offer, withBillingPurchases } from './billing-purchases.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('a lost admission COMMIT reply and worker restart preserve one intent and one possible creation claim', async () =>
  withBillingPurchases(
    async ({
      fixture,
      pool,
      run,
      policies,
      purchases,
      subject,
      store,
      key,
    }) => {
      await store.runFlagCommand(flagCommand(key, 0));
      const restore = loseTransactionCommitReply(pool, 2);
      try {
        await assertRejects({
          given: 'the database commits the purchase but its reply is lost',
          should: 'report uncertainty',
          code: 'INFRASTRUCTURE',
          actual: () => purchases.admit(subject, offer),
        });
      } finally {
        restore();
      }
      const restarted = createBillingPurchases({
        run,
        policies,
        nextId: createId,
      });
      const recovered = await restarted.admit(subject, offer);
      const claims = await Promise.all([
        restarted.recover(subject, recovered.purchase.id),
        purchases.recover(subject, recovered.purchase.id),
      ]);
      const [rows] =
        await fixture.sql`select count(*)::int as n from billing_purchases where user_id=${subject.userId}`;
      assert({
        given: 'a fresh operation instance and two racing dispatchers',
        should:
          'reuse committed admission and allow only one live creation claim',
        actual: [
          recovered.kind,
          rows!.n,
          claims.map((c) => c.work).sort(),
          JSON.stringify(claims[0]!.purchase.state) ===
            JSON.stringify(claims[1]!.purchase.state),
        ],
        expected: ['existing', 1, ['create', 'wait'], true],
      });
      assert({
        given: 'a stale worker guessing another claim ID',
        should: 'fail to mark that admitted attempt unknown',
        actual: await restarted.record(subject, recovered.purchase.id, {
          kind: 'unknown',
          claimId: createId(),
        }),
        expected: 'refuse',
      });
    },
  ));

test('verified completion commits immutable vendor identity and unpaid synchronization atomically without granting access', async () =>
  withBillingPurchases(
    async ({ fixture, pool, purchases, subject, store, key }) => {
      await store.runFlagCommand(flagCommand(key, 0));
      const first = await purchases.admit(subject, offer);
      await purchases.recover(subject, first.purchase.id);
      const session = {
        kind: 'complete' as const,
        id: `cs_test_${createId()}`,
        customerId: `cus_${createId()}`,
        subscriptionId: `sub_${createId()}`,
      };
      const restore = loseTransactionCommitReply(pool, 2);
      try {
        await assertRejects({
          given:
            'the complete Session and its mapping commit but the reply is lost',
          should: 'report uncertainty without duplicate mapping on recovery',
          code: 'INFRASTRUCTURE',
          actual: () =>
            purchases.record(subject, first.purchase.id, {
              kind: 'observe',
              session,
            }),
        });
      } finally {
        restore();
      }
      const duplicate = await purchases.record(subject, first.purchase.id, {
        kind: 'observe',
        session,
      });
      const stale = await purchases.record(subject, first.purchase.id, {
        kind: 'observe',
        session: { ...session, kind: 'open' },
      });
      const forged = await purchases.record(subject, first.purchase.id, {
        kind: 'observe',
        session: { ...session, subscriptionId: `sub_${createId()}` },
      });
      const [customer] =
        await fixture.sql`select vendor_customer_id, synchronization->>'kind' as kind, (synchronization->>'revision')::int as revision from billing_customers where user_id=${subject.userId}`;
      const subscriptions =
        await fixture.sql`select vendor_subscription_id, evidence, current from billing_subscriptions where user_id=${subject.userId}`;
      const [grants] =
        await fixture.sql`select count(*)::int as n from account_entitlement_grants where user_id=${subject.userId} and source='subscription'`;
      assert({
        given:
          'duplicate completion, reversed old-open response and a changed subscription identity',
        should:
          'keep one pending unpaid mapping, retain terminal identity and issue no grants',
        actual: [
          duplicate,
          stale,
          forged,
          customer,
          [...subscriptions],
          grants!.n,
        ],
        expected: [
          'unchanged',
          'unchanged',
          'refuse',
          {
            vendor_customer_id: session.customerId,
            kind: 'pending',
            revision: 1,
          },
          [
            {
              vendor_subscription_id: session.subscriptionId,
              evidence: {
                lifecycle: 'incomplete',
                settlement: { kind: 'unpaid' },
              },
              current: true,
            },
          ],
          0,
        ],
      });
      await assertRejects({
        given: 'another new purchase before the first subscription is resolved',
        should: 'refuse a second vendor subscription',
        code: 'CONFLICT',
        actual: () => purchases.admit(subject, offer),
      });
    },
  ));

test('a crashed completion transaction rolls back every mapping and preserves the possible purchase for recovery', async () =>
  withBillingPurchases(
    async ({ fixture, run, policies, purchases, subject, store, key }) => {
      await store.runFlagCommand(flagCommand(key, 0));
      const first = await purchases.admit(subject, offer);
      const claimed = await purchases.recover(subject, first.purchase.id);
      const session = {
        kind: 'complete' as const,
        id: `cs_test_${createId()}`,
        customerId: `cus_${createId()}`,
        subscriptionId: `sub_${createId()}`,
      };
      let terminated = false;
      const crashing = createBillingPurchases({
        policies,
        nextId: createId,
        run: (work, options) =>
          run(async (...args) => {
            const result = await work(...args);
            const { writer } = args[2];
            const [killed] =
              await fixture.sql`select pg_terminate_backend(pid,500) as stopped from pg_stat_activity where pid=${writer.pid} and backend_start::text=${writer.backendStart}`;
            terminated = killed?.stopped === true;
            if (!terminated)
              throw Error('Owned purchase writer was not terminated');
            return result;
          }, options),
      });
      await assertRejects({
        given: 'the owned backend dies after writes and before commit',
        should: 'fail the operation',
        code: 'INFRASTRUCTURE',
        actual: () =>
          crashing.record(subject, first.purchase.id, {
            kind: 'observe',
            session,
          }),
      });
      const [rows] =
        await fixture.sql`select (select count(*)::int from billing_customers where user_id=${subject.userId}) as customers, (select count(*)::int from billing_subscriptions where user_id=${subject.userId}) as subscriptions`;
      assert({
        given: 'the terminated writer',
        should: 'retain possible dispatch and no partial mapping',
        actual: [
          terminated,
          rows,
          (await purchases.read(subject, first.purchase.id)).state,
        ],
        expected: [
          true,
          { customers: 0, subscriptions: 0 },
          claimed.purchase.state,
        ],
      });
      assert({
        given: 'the next verified observation after restart',
        should: 'complete the original attempt',
        actual: await purchases.record(subject, first.purchase.id, {
          kind: 'observe',
          session,
        }),
        expected: 'changed',
      });
    },
  ));
