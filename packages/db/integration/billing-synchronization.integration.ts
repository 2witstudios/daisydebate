import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withBillingSynchronization } from './billing-synchronization.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('durable webhook receipts survive an abandoned fetch and duplicates cannot churn a healthy claim', async () => {
  await withBillingSynchronization(
    async ({
      fixture,
      customerId,
      userId,
      vendorCustomerId,
      inbox,
      store,
      paid,
    }) => {
      const event = {
        eventId: `evt_${createId()}`,
        customerId: vendorCustomerId,
        mode: 'test' as const,
      };
      assert({
        given:
          'a verified receipt followed by a crashed worker before any vendor fetch',
        should: 'commit retryable pending work',
        actual: await inbox(event),
        expected: 'recorded',
      });
      const claims = await Promise.all([
        store.claim(customerId),
        store.claim(customerId),
      ]);
      const claim = claims.find((value) => value !== null)!;
      assert({
        given: 'two concurrent workers and a replayed delivery',
        should: 'admit one worker and preserve its exact generation',
        actual: [
          claims.filter(Boolean).length,
          await inbox(event),
          await store.apply(claim, paid),
        ],
        expected: [1, 'duplicate', 'applied'],
      });
      const [row] =
        await fixture.sql`select count(*)::integer as n from account_entitlement_grants where user_id=${userId} and source='subscription'`;
      assert({
        given: 'an applied verified payment then repeated completion',
        should: 'write all five grants once and refuse the old claim',
        actual: [row!.n, await store.apply(claim, paid)],
        expected: [5, 'stale'],
      });
    },
  );
});

test('new hints fence reversed vendor responses and terminal cancellation cannot resurrect', async () => {
  await withBillingSynchronization(
    async ({
      fixture,
      customerId,
      userId,
      vendorCustomerId,
      inbox,
      store,
      paid,
    }) => {
      const original = (await store.claim(customerId))!;
      await inbox({
        eventId: `evt_${createId()}`,
        customerId: vendorCustomerId,
        mode: 'test',
      });
      const current = (await store.claim(customerId))!;
      assert({
        given: 'the old fetch returns while a newer claimant is still active',
        should: 'refuse before the newer worker has published any result',
        actual: await store.apply(original, paid),
        expected: 'stale',
      });
      const canceled = { ...paid, lifecycle: 'canceled' as const };
      assert({
        given:
          'a newer cancellation response finishes before the original paid fetch',
        should: 'apply only the current generation',
        actual: [
          await store.apply(current, canceled),
          await store.apply(original, paid),
        ],
        expected: ['applied', 'stale'],
      });
      await inbox({
        eventId: `evt_${createId()}`,
        customerId: vendorCustomerId,
        mode: 'test',
      });
      const staleVendor = (await store.claim(customerId))!;
      await store.apply(staleVendor, paid);
      const [row] =
        await fixture.sql`select evidence->>'lifecycle' as lifecycle from billing_subscriptions where user_id=${userId} and current`;
      const [grants] =
        await fixture.sql`select count(*)::integer as n from account_entitlement_grants where user_id=${userId} and source='subscription'`;
      assert({
        given:
          'a still-stale active vendor read after cancellation was already observed',
        should: 'retain terminal cancellation and no grants',
        actual: [row!.lifecycle, grants!.n],
        expected: ['canceled', 0],
      });
    },
  );
});

test('current account authority wins over a paid response that arrives after closure', async () => {
  await withBillingSynchronization(
    async ({ fixture, customerId, userId, store, paid }) => {
      const claim = (await store.claim(customerId))!;
      await fixture.sql`update users set deleted_at=clock_timestamp(),version=version+1 where id=${userId}`;
      assert({
        given: 'a paid fetch that began before the canonical account closed',
        should: 'refuse application and further claims',
        actual: [await store.apply(claim, paid), await store.claim(customerId)],
        expected: ['stale', null],
      });
      const [row] =
        await fixture.sql`select evidence->'settlement'->>'kind' as kind from billing_subscriptions where user_id=${userId} and current`;
      const [grants] =
        await fixture.sql`select count(*)::integer as n from account_entitlement_grants where user_id=${userId}`;
      assert({
        given: 'the refused response',
        should: 'leave evidence and grants unchanged',
        actual: [row!.kind, grants!.n],
        expected: ['unpaid', 0],
      });
    },
  );
});
