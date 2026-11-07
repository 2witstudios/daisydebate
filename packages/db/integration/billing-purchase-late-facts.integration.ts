import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../src/index';
import { erasePrivacySubject, deliverPrivacyJob } from '../src/privacy';
import { bindings } from './privacy.test-support';
import { flagCommand } from './flags.test-support';
import { offer, withBillingPurchases } from './billing-purchases.test-support';
import { createBillingPurchaseRecovery } from '../src/billing-purchase-recovery';
import { currentWebTransaction } from '../src/web-service-authority';
import { loseTransactionCommitReply } from './bounded-transaction.test-support';

const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();
const rooms = {
  closeRoom: <T>(room: T) => room,
  eraseSeats: <T>(room: T) => room,
  activeRoomMembers: () => [],
};

test('new late Checkout facts atomically reopen cleanup and fence old completion; exact replay preserves the job', async () =>
  withBillingPurchases(
    async ({ fixture, pool, run, purchases, subject, store, key }) => {
      await store.runFlagCommand(flagCommand(key, 0));
      const admitted = await purchases.admit(subject, offer);
      await purchases.recover(subject, admitted.purchase.id);
      const reserve = pool.reserve.bind(pool);
      pool.reserve = async (options) => {
        const connection = await reserve(options);
        await connection`set role daisy_web`;
        return connection;
      };
      assert({
        given: 'the production recovery database role',
        should: 'execute with actual daisy_web grants',
        actual: await run(
          async (tx) =>
            (await tx.execute(sql`select current_user as role`))[0]?.role,
        ),
        expected: 'daisy_web',
      });
      const database = createDatabase({
        url: databaseUrl,
        client: pool,
        nextActorId: createId,
      });
      const instanceId = createId();
      await database.renewServiceInstance({ instanceId, role: 'web' });
      const recovery = database.billingPurchaseRecovery(instanceId);
      const db = drizzle({ client: fixture.sql });
      const jobId = createId();
      const [clock] = await fixture.sql`select clock_timestamp() as now`;
      const now = clock!.now.toISOString();
      const retryAt = new Date(clock!.now.getTime() + 60_000).toISOString();
      const event = {
        kind: 'observe' as const,
        session: {
          kind: 'complete' as const,
          id: `cs_test_${createId()}`,
          customerId: `cus_${createId()}`,
          subscriptionId: `sub_${createId()}`,
        },
      };
      try {
        await erasePrivacySubject(
          db,
          { subject, now, vendors: ['stripe'], jobIds: [jobId] },
          rooms,
          bindings,
        );
        let finish!: () => void;
        const release = new Promise<void>((resolve) => {
          finish = resolve;
        });
        let started!: () => void;
        const entered = new Promise<void>((resolve) => {
          started = resolve;
        });
        const delivery = deliverPrivacyJob(
          db,
          { jobId, vendor: 'stripe', now, retryAt },
          {
            erase: async () => {
              started();
              await release;
            },
          },
        );
        // Observe failures immediately; always release the paused transport.
        void delivery.catch(started);
        try {
          await entered;
          await recovery.record(admitted.purchase.id, {
            kind: 'searched',
            beforeSessionId: null,
            afterSessionId: null,
          });
          const [searchJob] =
            await fixture.sql`select id from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
          assert({
            given: 'an empty discovery page after closure',
            should: 'retain the same owed job and possible execution',
            actual: searchJob!.id,
            expected: jobId,
          });
          assert({
            given: 'a verified completion after local closure',
            should: 'commit the cleanup fact',
            actual: await recovery.record(admitted.purchase.id, event),
            expected: 'changed',
          });
        } finally {
          finish();
          await delivery;
        }
        assert({
          given: 'old vendor work finishing after new facts rotate the job ID',
          should: 'report idle rather than claim the new obligation succeeded',
          actual: await delivery,
          expected: 'idle',
        });
        const [job] =
          await fixture.sql`select id,status,attempts from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        const repeated = await Promise.all([
          recovery.record(admitted.purchase.id, event),
          recovery.record(admitted.purchase.id, event),
        ]);
        const [again] =
          await fixture.sql`select id,status,attempts from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        const [effects] = await fixture.sql`select
        (select closed_at is not null from billing_customers where user_id=${subject.userId}) as closed,
        (select count(*)::int from billing_subscriptions where user_id=${subject.userId}) as subscriptions,
        (select count(*)::int from account_entitlement_grants where user_id=${subject.userId}) as grants`;
        assert({
          given: 'new customer identity and duplicate facts after closure',
          should:
            'retain closed cleanup identity with no access, a new pending job and no duplicate job churn',
          actual: [job!.id !== jobId, job!.status, repeated, again, effects],
          expected: [
            true,
            'pending',
            ['unchanged', 'unchanged'],
            job,
            { closed: true, subscriptions: 0, grants: 0 },
          ],
        });
      } finally {
        await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
        await fixture.sql`delete from privacy_jobs where subject_ref=${subject.userId}`;
      }
    },
  ));

test('a killed late-fact transaction rolls back cleanup and identity together; a lost COMMIT reply reuses both', async () =>
  withBillingPurchases(
    async ({ fixture, pool, run, purchases, subject, store, key }) => {
      await store.runFlagCommand(flagCommand(key, 0));
      const admitted = await purchases.admit(subject, offer);
      const claimed = await purchases.recover(subject, admitted.purchase.id);
      const database = createDatabase({
        url: databaseUrl,
        client: pool,
        nextActorId: createId,
      });
      const instanceId = createId();
      await database.renewServiceInstance({ instanceId, role: 'web' });
      const jobId = createId();
      const [clock] = await fixture.sql`select clock_timestamp() as now`;
      const event = {
        kind: 'observe' as const,
        session: {
          kind: 'complete' as const,
          id: `cs_test_${createId()}`,
          customerId: `cus_${createId()}`,
          subscriptionId: `sub_${createId()}`,
        },
      };
      try {
        await erasePrivacySubject(
          drizzle({ client: fixture.sql }),
          {
            subject,
            now: clock!.now.toISOString(),
            vendors: ['stripe'],
            jobIds: [jobId],
          },
          rooms,
          bindings,
        );
        let terminated = false;
        const crashing = createBillingPurchaseRecovery({
          nextId: createId,
          run: currentWebTransaction(
            (callback, options) =>
              run(async (...args) => {
                const result = await callback(...args);
                const { writer } = args[2];
                const [killed] =
                  await fixture.sql`select pg_terminate_backend(pid,500) as stopped from pg_stat_activity where pid=${writer.pid} and backend_start::text=${writer.backendStart}`;
                terminated = killed?.stopped === true;
                if (!terminated) throw Error('Owned writer was not terminated');
                return result;
              }, options),
            instanceId,
          ),
        });
        await assertRejects({
          given: 'the owned writer dies after mapping, job and purchase writes',
          should: 'report failure before commit',
          code: 'INFRASTRUCTURE',
          actual: () => crashing.record(admitted.purchase.id, event),
        });
        const [before] =
          await fixture.sql`select state from billing_purchases where id=${admitted.purchase.id}`;
        const [job] =
          await fixture.sql`select id from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        const [mapping] =
          await fixture.sql`select count(*)::int as n from billing_customers where user_id=${subject.userId}`;
        assert({
          given: 'backend termination before COMMIT',
          should: 'leave all prior evidence and the original job intact',
          actual: [terminated, before!.state, job!.id, mapping!.n],
          expected: [true, claimed.purchase.state, jobId, 0],
        });
        const recovery = database.billingPurchaseRecovery(instanceId);
        const restore = loseTransactionCommitReply(pool, 2);
        try {
          await assertRejects({
            given: 'the replacement transaction commits but its reply is lost',
            should: 'report uncertainty',
            code: 'INFRASTRUCTURE',
            actual: () => recovery.record(admitted.purchase.id, event),
          });
        } finally {
          restore();
        }
        const [committed] =
          await fixture.sql`select id,status from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        const outcome = await recovery.record(admitted.purchase.id, event);
        const [replayed] =
          await fixture.sql`select id,status from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
        assert({
          given: 'recovery after the lost commit reply',
          should:
            'reuse the committed cleanup obligation without another rotation',
          actual: [outcome, committed!.id !== jobId, replayed],
          expected: ['unchanged', true, committed],
        });
      } finally {
        await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
        await fixture.sql`delete from privacy_jobs where subject_ref=${subject.userId}`;
      }
    },
  ));
