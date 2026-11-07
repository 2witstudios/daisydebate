import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src/index';
import { lockAuthorizationActors } from '../src/authorization';
import { finishedOrBlockedBehind } from '../src/testing';
import { withHeldCommit } from './usage-ledger.test-support';
import { flagCommand } from './flags.test-support';
import { offer, withBillingPurchases } from './billing-purchases.test-support';

const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();

test('current service discovery pages durable purchase identities and preserves closed-account cleanup authority only', async () =>
  withBillingPurchases(
    async ({ fixture, pool, purchases, subject, store, key }) => {
      await store.runFlagCommand(flagCommand(key, 0));
      const admitted = await purchases.admit(subject, offer);
      const claimed = await purchases.recover(subject, admitted.purchase.id);
      const database = createDatabase({
        url: databaseUrl,
        client: pool,
        nextActorId: createId,
      });
      const instanceId = createId();
      const recovery = database.billingPurchaseRecovery(instanceId);
      try {
        await assertRejects({
          given: 'an unregistered service',
          should: 'refuse purchase discovery',
          code: 'AUTHORIZATION',
          actual: () => recovery.purchases({ mode: 'test', limit: 1 }),
        });
        await database.renewServiceInstance({ instanceId, role: 'web' });
        const page = await recovery.purchases({ mode: 'test', limit: 1 });
        const empty = await recovery.purchases({
          mode: 'test',
          limit: 1,
          afterId: page.afterId!,
        });
        const active = await recovery.inspect(admitted.purchase.id);
        await fixture.sql`update users set deleted_at=clock_timestamp(),email_verified=false,version=version+1 where id=${subject.userId}`;
        const closed = await recovery.inspect(admitted.purchase.id);
        assert({
          given:
            'a restarted current worker reading one possible purchase before and after its account tombstone',
          should:
            'bound pagination, exclude other mode and expose only cleanup for closed authority without altering its evidence',
          actual: [
            page.rows,
            page.exhausted,
            empty.rows,
            empty.exhausted,
            (await recovery.purchases({ mode: 'live', limit: 1 })).rows,
            active?.context.authority,
            closed?.context.authority,
            closed?.work,
            closed?.purchase.state,
            closed?.closedAt !== null,
          ],
          expected: [
            [{ purchaseId: admitted.purchase.id }],
            false,
            [],
            true,
            [],
            'active',
            'closed',
            'cleanup',
            claimed.purchase.state,
            true,
          ],
        });
        await assertRejects({
          given: 'an oversized page',
          should: 'refuse before unbounded discovery',
          code: 'VALIDATION',
          actual: () => recovery.purchases({ mode: 'test', limit: 101 }),
        });
      } finally {
        await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      }
    },
  ));

for (const operation of ['inspect', 'record'] as const)
  test(`a service that expires while waiting for the purchase account fence cannot ${operation} recovery facts`, async () =>
    withBillingPurchases(
      async ({ fixture, pool, run, purchases, subject, store, key }) => {
        await store.runFlagCommand(flagCommand(key, 0));
        const admitted = await purchases.admit(subject, offer);
        await purchases.recover(subject, admitted.purchase.id);
        const database = createDatabase({
          url: databaseUrl,
          client: pool,
          nextActorId: createId,
        });
        const instanceId = createId();
        const recovery = database.billingPurchaseRecovery(instanceId);
        await database.renewServiceInstance({ instanceId, role: 'web' });
        try {
          await withHeldCommit(run, async (held) => {
            const holder = held.run(async (tx) => {
              await lockAuthorizationActors(tx, [subject.actorId], {
                maxActors: 1,
              });
            });
            const pid = await held.entered;
            const pending = held.observe<unknown>(
              operation === 'inspect'
                ? recovery.inspect(admitted.purchase.id)
                : recovery.record(admitted.purchase.id, {
                    kind: 'observe',
                    session: {
                      kind: 'complete',
                      id: `cs_test_${createId()}`,
                      customerId: `cus_${createId()}`,
                      subscriptionId: `sub_${createId()}`,
                    },
                  }),
            );
            try {
              assert({
                given: 'current service recovery',
                should: 'wait on the actual canonical account fence',
                actual: await finishedOrBlockedBehind(
                  pending,
                  fixture.sql,
                  pid,
                  {
                    now: performance.now,
                    deadlineMs: 500,
                  },
                ),
                expected: 'blocked',
              });
              await fixture.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
            } finally {
              held.release();
            }
            await holder;
            await assertRejects({
              given: 'service authority expired during that wait',
              should: 'refuse at the final service fence',
              code: 'AUTHORIZATION',
              actual: () => pending,
            });
          });
          const [effects] = await fixture.sql`select
          (select state->>'kind' from billing_purchases where id=${admitted.purchase.id}) as kind,
          (select count(*)::int from billing_customers where user_id=${subject.userId}) as customers`;
          assert({
            given: 'service expiry across the account wait',
            should: 'roll back any attempted fact or mapping writes',
            actual: effects,
            expected: { kind: 'creating', customers: 0 },
          });
        } finally {
          await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
        }
      },
    ));
