import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { lockFlags } from '../src/flags-lock';
import { lockAuthorizationActors } from '../src/authorization';
import { finishedOrBlockedBehind } from '../src/testing';
import { withHeldCommit } from './usage-ledger.test-support';
import { flagCommand, waitingForFlags } from './flags.test-support';
import { offer, withBillingPurchases } from './billing-purchases.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('purchase admission commits one immutable intent under the actual bounded Flags transaction and canonical account fence', async () =>
  withBillingPurchases(async ({ fixture, purchases, subject, store, key }) => {
    await assertRejects({
      given: 'the default-dark release flag',
      should: 'refuse a new purchase',
      code: 'NOT_FOUND',
      actual: () => purchases.admit(subject, offer),
    });
    await store.runFlagCommand(flagCommand(key, 0));
    const results = await Promise.all([
      purchases.admit(subject, offer),
      purchases.admit(subject, offer),
    ]);
    const [rows] =
      await fixture.sql`select count(*)::int as count, min(to_char(admitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as admitted from billing_purchases where user_id=${subject.userId}`;
    assert({
      given:
        'concurrent native-form-equivalent admissions after enabling the flag',
      should:
        'commit one purchase and return the same admitted identity to the duplicate',
      actual: [
        results.map((r) => r.kind).sort(),
        new Set(results.map((r) => r.purchase.id)).size,
        rows!.count,
        rows!.admitted,
      ],
      expected: [
        ['admitted', 'existing'],
        1,
        1,
        results[0]!.purchase.admittedAt,
      ],
    });
    const [grants] =
      await fixture.sql`select count(*)::int as count from account_entitlement_grants where user_id=${subject.userId} and source='subscription'`;
    assert({
      given: 'a durable purchase admission without any verified payment',
      should: 'grant no paid capability',
      actual: grants!.count,
      expected: 0,
    });
  }));

test('a dark new-purchase gate leaves only exact-account same-intent recovery available', async () =>
  withBillingPurchases(async ({ fixture, purchases, subject, store, key }) => {
    await store.runFlagCommand(flagCommand(key, 0));
    const first = await purchases.admit(subject, offer);
    await store.runFlagCommand(
      flagCommand(key, 1, { action: 'flag.state.update', state: 'killed' }),
    );
    const recovered = await purchases.recover(subject, first.purchase.id);
    const duplicate = await purchases.admit(subject, {
      ...offer,
      priceId: 'price_other',
    });
    const [count] =
      await fixture.sql`select count(*)::int as n from billing_purchases where user_id=${subject.userId}`;
    assert({
      given:
        'the owning account explicitly recovers its admitted attempt after a kill',
      should:
        'retain frozen offer/time/identity and never authorize a new intent through that attempt',
      actual: [
        recovered.work,
        recovered.purchase.id,
        recovered.purchase.priceId,
        recovered.purchase.admittedAt,
        duplicate.kind,
        duplicate.purchase.id,
        count!.n,
      ],
      expected: [
        'create',
        first.purchase.id,
        offer.priceId,
        first.purchase.admittedAt,
        'existing',
        first.purchase.id,
        1,
      ],
    });
    await assertRejects({
      given: 'a forged purchase ID',
      should: 'refuse recovery',
      code: 'NOT_FOUND',
      actual: () => purchases.recover(subject, createId()),
    });
    await assertRejects({
      given: 'a different account bound to the current actor',
      should: 'refuse before the purchase read',
      code: 'AUTHORIZATION',
      actual: () =>
        purchases.recover(
          { ...subject, userId: createId() },
          first.purchase.id,
        ),
    });
  }));

test('a completed disable while admission waits is visible to its fresh post-lock Flags read', async () =>
  withBillingPurchases(
    async ({ fixture, run, purchases, subject, store, key }) => {
      await store.runFlagCommand(flagCommand(key, 0));
      await withHeldCommit(run, async (held) => {
        const holder = held.run(async (tx) => {
          await lockFlags(tx, 'write');
          await tx.execute(
            sql`update release_flags set state='disabled',revision=revision+1 where key=${key}`,
          );
        });
        await held.entered;
        const admission = held.observe(purchases.admit(subject, offer));
        try {
          await waitingForFlags(fixture);
        } finally {
          held.release();
        }
        await holder;
        await assertRejects({
          given:
            'the disable commits before the shared admission lock is acquired',
          should:
            'refuse with no durable purchase instead of using its earlier display read',
          code: 'NOT_FOUND',
          actual: () => admission,
        });
      });
      const [count] =
        await fixture.sql`select count(*)::int as n from billing_purchases where user_id=${subject.userId}`;
      assert({
        given: 'that refused bounded admission',
        should: 'leave purchase state unchanged',
        actual: count!.n,
        expected: 0,
      });
    },
  ));

test('account withdrawal wins a concurrent recovery and leaves the purchase undispatched', async () =>
  withBillingPurchases(
    async ({ fixture, run, purchases, subject, store, key }) => {
      await store.runFlagCommand(flagCommand(key, 0));
      const first = await purchases.admit(subject, offer);
      await withHeldCommit(run, async (held) => {
        const holder = held.run(async (tx) => {
          await lockAuthorizationActors(tx, [subject.actorId], {
            maxActors: 1,
          });
          await tx.execute(
            sql`update account_beta_access set state='revoked',revision=revision+1 where user_id=${subject.userId}`,
          );
        });
        const pid = await held.entered;
        const recovery = held.observe(
          purchases.recover(subject, first.purchase.id),
        );
        try {
          const wait = await finishedOrBlockedBehind(
            recovery,
            fixture.sql,
            pid,
            { now: performance.now, deadlineMs: 1000 },
          );
          if (wait !== 'blocked')
            throw Error('Recovery did not wait on the canonical account fence');
        } finally {
          held.release();
        }
        await holder;
        await assertRejects({
          given: 'participant authority is revoked while recovery waits',
          should: 'refuse the vendor creation claim',
          code: 'AUTHORIZATION',
          actual: () => recovery,
        });
      });
      assert({
        given: 'the revoked current member reading their own billing record',
        should: 'retain management visibility and original undispatched state',
        actual: (await purchases.read(subject, first.purchase.id)).state,
        expected: { kind: 'admitted' },
      });
      const [count] =
        await fixture.sql`select count(*)::int as n from billing_purchases where user_id=${subject.userId}`;
      assert({
        given: 'the refused recovery',
        should: 'have created no second intent',
        actual: count!.n,
        expected: 1,
      });
    },
  ));
