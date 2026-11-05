import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import type { RefundStatus } from '@daisy/protocol/billing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { lockAuthorizationActors } from '../src/authorization';
import { deliverPrivacyJob } from '../src/privacy';
import { withHeldCommit } from './usage-ledger.test-support';
import {
  shortRefundClaim,
  withBillingRefunds,
} from './billing-refunds.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('a refund observation delayed behind the account fence expires without changing durable facts', async () =>
  withBillingRefunds(async (input) => {
    const { refunds, userId, payment, fixture, run, actorId } = input;
    const admitted = await refunds.admit(userId, payment);
    if (!('action' in admitted)) throw Error('Refund fixture refused');
    const id = admitted.action.id;
    const oldClaim = await shortRefundClaim(input, id);
    const [before] =
      await fixture.sql`select state,claim from billing_refund_actions where id=${id}`;
    const [jobBefore] =
      await fixture.sql`select id from privacy_jobs where subject_ref=${userId}`;
    await withHeldCommit(run, async (held) => {
      const holder = held.run((tx) =>
        lockAuthorizationActors(tx, [actorId], { maxActors: 1 }),
      );
      const holderPid = await held.entered;
      const observation = held.observe(
        refunds.record(id, {
          kind: 'observe',
          claimId: oldClaim,
          refundId: `re_${createId()}`,
          status: 'succeeded',
        }),
      );
      let waiting = false;
      for (let attempt = 0; attempt < 80 && !waiting; attempt++) {
        const [edge] =
          await fixture.sql`select exists(select 1 from pg_stat_activity
          where datname=current_database() and ${holderPid}=any(pg_blocking_pids(pid))) as waiting`;
        waiting = edge!.waiting;
        if (!waiting) await Bun.sleep(5);
      }
      const [live] =
        await fixture.sql`select (claim->>'expiresAt')::timestamptz>clock_timestamp() as current from billing_refund_actions where id=${id}`;
      assert({
        given: 'an actual blocked PostgreSQL refund observation',
        should:
          'reach the canonical fence while its original claim is still current',
        actual: [waiting, live!.current],
        expected: [true, true],
      });
      await fixture.sql`select pg_sleep(greatest(0,extract(epoch from (claim->>'expiresAt')::timestamptz-clock_timestamp()))+0.02) from billing_refund_actions where id=${id}`;
      held.release();
      await holder;
      assert({
        given:
          'a valid claim at invocation expires during a real account lock wait',
        should: 'refuse the stale response',
        actual: await observation,
        expected: 'refuse',
      });
    });
    const [after] =
      await fixture.sql`select state,claim from billing_refund_actions where id=${id}`;
    const [jobAfter] =
      await fixture.sql`select id from privacy_jobs where subject_ref=${userId}`;
    assert({
      given: 'refused observation',
      should: 'leave state, claim and cleanup job unchanged',
      actual: [after, jobAfter],
      expected: [before, jobBefore],
    });
    const current = await refunds.claim(id);
    if (!current?.action.claim) throw Error('Missing replacement claim');
    const refundId = `re_${createId()}`;
    await refunds.record(id, {
      kind: 'observe',
      claimId: current.action.claim.id,
      refundId,
      status: 'failed',
    });
    const stale = await refunds.record(id, {
      kind: 'observe',
      claimId: oldClaim,
      refundId,
      status: 'succeeded',
    });
    const [final] =
      await fixture.sql`select state->>'status' as status from billing_refund_actions where id=${id}`;
    assert({
      given: 'the old success arrives after a new claimed failed observation',
      should: 'preserve the fresh failure',
      actual: [stale, final!.status],
      expected: ['refuse', 'failed'],
    });
  }));

async function observeRefund(
  refunds: Parameters<Parameters<typeof withBillingRefunds>[0]>[0]['refunds'],
  id: string,
  refundId: string,
  status: RefundStatus,
) {
  const current = await refunds.claim(id);
  if (!current?.action.claim) throw Error('Missing current observation claim');
  return refunds.record(id, {
    kind: 'observe',
    claimId: current.action.claim.id,
    refundId,
    status,
  });
}

test('late failed and action-required refunds reopen cleanup after customer deletion; stale job completion and duplicate reads cannot erase the obligation', async () =>
  withBillingRefunds(async ({ fixture, refunds, userId, payment, run }) => {
    const admitted = await refunds.admit(userId, payment);
    if (!('action' in admitted)) throw Error('Refund fixture refused');
    const id = admitted.action.id,
      refundId = `re_${createId()}`;
    await observeRefund(refunds, id, refundId, 'succeeded');
    await fixture.sql`delete from billing_customers where user_id=${userId}`;
    const [oldJob] =
      await fixture.sql`select id from privacy_jobs where subject_ref=${userId}`;
    const [clock] = await fixture.sql`select clock_timestamp() as now`;
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const delivery = deliverPrivacyJob(
      drizzle({ client: fixture.sql }),
      {
        jobId: oldJob!.id,
        vendor: 'stripe',
        now: clock!.now.toISOString(),
        retryAt: new Date(clock!.now.getTime() + 60_000).toISOString(),
      },
      {
        erase: async () => {
          entered.resolve();
          await release.promise;
        },
      },
    );
    void delivery.catch(entered.reject);
    try {
      await entered.promise;
      await observeRefund(refunds, id, refundId, 'failed');
    } finally {
      release.resolve();
      await delivery;
    }
    const [failedJob] =
      await fixture.sql`select id,status from privacy_jobs where subject_ref=${userId}`;
    assert({
      given: 'a fresh failed observation after vendor/customer cleanup',
      should: 'retain routing and rotate the obligation before old completion',
      actual: [
        await delivery,
        failedJob!.id !== oldJob!.id,
        failedJob!.status,
        (await refunds.actions({ mode: 'test', limit: 100 })).rows.some(
          (r) => r.actionId === id,
        ),
      ],
      expected: ['idle', true, 'pending', true],
    });
    await observeRefund(refunds, id, refundId, 'requires_action');
    const [actionJob] =
      await fixture.sql`select id,status from privacy_jobs where subject_ref=${userId}`;
    await observeRefund(refunds, id, refundId, 'requires_action');
    const [sameJob] =
      await fixture.sql`select id,status from privacy_jobs where subject_ref=${userId}`;
    const original = await refunds.admit(userId, payment);
    const [facts] = await run((tx) =>
      tx.execute(sql`select
      (select count(*)::int from account_entitlement_grants where user_id=${userId}) as grants,
      (select count(*)::int from billing_subscriptions where user_id=${userId}) as subscriptions,
      (select deleted_at is not null from users where id=${userId}) as closed`),
    );
    assert({
      given:
        'new action-required fact followed by an identical fresh read and original-payment replay',
      should: 'rotate once, retain the same action, and never resurrect access',
      actual: [
        actionJob!.id !== failedJob!.id,
        sameJob,
        original.kind,
        'action' in original && original.action.id,
        facts,
      ],
      expected: [
        true,
        actionJob,
        'existing',
        id,
        { grants: 0, subscriptions: 0, closed: true },
      ],
    });
  }));
