import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { offer } from './billing-purchases.test-support';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
requireTestServices(process.env);
setupRitewayBun();

test('actual runtime cleanup cannot acknowledge an unmapped possibly executed purchase', async () =>
  withClosedPurchase(
    false,
    async ({ fixture, run, subject, cleanup, jobId }) => {
      const role = await run(
        async (tx) =>
          (await tx.execute(sql`select current_user as role`))[0]!.role,
      );
      const c = await cleanup.claim(jobId);
      if (
        c.kind !== 'claimed' ||
        c.state.kind === 'acknowledged' ||
        !c.state.claim
      )
        throw Error('Missing purchase cleanup claim');
      const [before] =
        await fixture.sql`select status,attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
      const result = await cleanup.record(jobId, {
        kind: 'no-effects',
        claimId: c.state.claim.id,
        work: c.work,
      });
      const [after] =
        await fixture.sql`select status,attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
      const [purchase] =
        await fixture.sql`select price_id,state->>'kind' as kind from billing_purchases where user_id=${subject.userId}`;
      assert({
        given:
          'closed account with no customer mapping but an original dispatched Checkout attempt',
        should:
          'preserve owed purchase and current job unchanged under actual daisy_web authority',
        actual: [role, c.facts, result, after, purchase],
        expected: [
          'daisy_web',
          {
            effects: {
              mappedCustomers: 0,
              possiblePurchases: 1,
              retainedFinancialRoutes: 0,
              owedObservations: false,
            },
            route: { kind: 'absent' },
          },
          'idle',
          before,
          { price_id: offer.priceId, kind: 'creating' },
        ],
      });
    },
  ));

test('cleanup frozen offer survives mapping deletion and later live configuration changes; stale work and service refuse', async () =>
  withClosedPurchase(
    true,
    async ({ fixture, subject, cleanup, instanceId, jobId, session }) => {
      await fixture.sql`delete from billing_customers where user_id=${subject.userId}`;
      const c = await cleanup.claim(jobId);
      if (
        c.kind !== 'claimed' ||
        c.state.kind === 'acknowledged' ||
        !c.state.claim
      )
        throw Error('Missing frozen offer cleanup claim');
      const claimId = c.state.claim.id;
      const [purchase] =
        await fixture.sql`select id,admitted_at from billing_purchases where user_id=${subject.userId} and state->>'kind'='complete'`;
      const original = await cleanup.frozenOffer(
        jobId,
        c.state.claim.id,
        c.work,
        session.subscriptionId,
      );
      const stale = await cleanup.frozenOffer(
        jobId,
        createId(),
        c.work,
        session.subscriptionId,
      );
      const foreign = await cleanup.frozenOffer(
        jobId,
        c.state.claim.id,
        c.work,
        `sub_${createId()}`,
      );
      assert({
        given:
          'price_fixture admitted before closure and hypothetical current price_changed, with the mapping gone',
        should:
          'derive only immutable original purchase routing/offer, refuse other token/subscription and never accept current price as an input',
        actual: [c.facts.route, original, stale, foreign],
        expected: [
          { kind: 'owned', mode: 'test', customerId: session.customerId },
          {
            kind: 'owned',
            source: {
              kind: 'purchase',
              purchaseId: purchase!.id,
              vendorSubscriptionId: session.subscriptionId,
              priceId: offer.priceId,
              admittedAt: purchase!.admitted_at.toISOString(),
            },
            owner: {
              mode: 'test',
              customerId: session.customerId,
              priceId: offer.priceId,
              vendorSubscriptionId: session.subscriptionId,
            },
          },
          { kind: 'unresolved' },
          { kind: 'unresolved' },
        ],
      });
      await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      const [before] =
        await fixture.sql`select status,attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
      await assertRejects({
        given: 'service loses current authority after receiving its work',
        should: 'refuse progress before changing the durable job',
        code: 'AUTHORIZATION',
        actual: () =>
          cleanup.record(jobId, {
            kind: 'page',
            claimId,
            work: c.work,
            ids: [],
            more: false,
          }),
      });
      const [after] =
        await fixture.sql`select status,attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
      assert({
        given: 'refused stale service',
        should: 'retain exact job state',
        actual: after,
        expected: before,
      });
    },
  ));
