import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import {
  canManageBilling,
  canPurchasePremium,
} from '@daisy/auth/authorization';
import { createBillingMember } from '../src/billing-member';
import { withBillingPurchases, offer } from './billing-purchases.test-support';
import { withFreeBundle } from './usage-ledger.test-support';
import { flagCommand } from './flags.test-support';
requireTestServices(process.env);
setupRitewayBun();

const policies = { manage: canManageBilling, purchase: canPurchasePremium };
test('owned native member reads carry no usage and refuse forged account routing', async () =>
  withBillingPurchases(async ({ run, subject }) => {
    const member = createBillingMember({ run, ...policies });
    const view = await member.read(subject);
    assert({
      given: 'a current free account with no counted bot use',
      should: 'read no invented customer, renewal or price, and no usage',
      actual: [
        view.hasCustomer,
        view.evidence,
        view.purchaseAllowed,
        view.renewalOff,
        view.amountMinor,
        'botDebates' in view,
      ],
      expected: [false, null, true, false, null, false],
    });
    await assertRejects({
      given: 'another user ID paired with this actor',
      should: 'refuse both private reads and Portal routing',
      code: 'AUTHORIZATION',
      actual: () => member.portalCustomer({ ...subject, userId: createId() }),
    });
  }));
test('a completed Checkout owns management routing but grants no paid access or second subscription', async () =>
  withBillingPurchases(async ({ run, subject, purchases, store, key }) => {
    await store.runFlagCommand(flagCommand(key, 0));
    const admitted = await purchases.admit(subject, offer);
    await purchases.recover(subject, admitted.purchase.id);
    const customerId = `cus_${createId()}`;
    await purchases.record(subject, admitted.purchase.id, {
      kind: 'observe',
      session: {
        kind: 'complete',
        id: `cs_test_${createId()}`,
        customerId,
        subscriptionId: `sub_${createId()}`,
      },
    });
    // Kill new-purchase release after completing the original identity.
    await store.runFlagCommand(
      flagCommand(key, 1, { action: 'flag.state.update', state: 'killed' }),
    );
    const member = createBillingMember({ run, ...policies });
    const view = await member.read(subject);
    assert({
      given:
        'a verified complete session with no verified paid invoice and a killed purchase flag',
      should:
        'preserve owned management without paid access or duplicate admission',
      actual: [
        await member.portalCustomer(subject),
        view.evidence?.settlement.kind,
        view.purchaseAllowed,
      ],
      expected: [{ id: customerId, mode: 'test' }, 'unpaid', false],
    });
  }));

test('a spent free bot debate leaves billing without any counter', async () =>
  withFreeBundle(async ({ f, run, actorId }) => {
    const [actor] = await f.sql`select user_id from actors where id=${actorId}`;
    const member = createBillingMember({ run, ...policies });
    const view = await member.read({ userId: actor!.user_id, actorId });
    assert({
      given: 'the real existing allowance admission reserved the free bundle',
      should: 'read the plan facts only: no count, limit or source (PYL-10)',
      actual: Object.keys(view).sort(),
      expected: [
        'amountMinor',
        'evidence',
        'hasCustomer',
        'now',
        'purchaseAllowed',
        'renewalOff',
        'subscriptionLifecycle',
      ],
    });
  }));

test('the actual web role reads only current owned member facts and Portal routing', async () =>
  withBillingPurchases(
    async ({ run, pool, subject, purchases, store, key }) => {
      await store.runFlagCommand(flagCommand(key, 0));
      const first = await purchases.admit(subject, offer);
      await purchases.recover(subject, first.purchase.id);
      const customerId = `cus_${createId()}`;
      await purchases.record(subject, first.purchase.id, {
        kind: 'observe',
        session: {
          kind: 'complete',
          id: `cs_test_${createId()}`,
          customerId,
          subscriptionId: `sub_${createId()}`,
        },
      });
      const reserve = pool.reserve.bind(pool);
      pool.reserve = async (options) => {
        const connection = await reserve(options);
        await connection`set role daisy_web`;
        return connection;
      };
      const role = await run(
        async (tx) =>
          (await tx.execute(sql`select current_user as role`))[0]?.role,
      );
      const member = createBillingMember({ run, ...policies });
      const view = await member.read(subject);
      assert({
        given: 'actual daisy_web execution after stable purchase completion',
        should: 'read current own customer without inventing paid access',
        actual: [
          role,
          await member.portalCustomer(subject),
          view.evidence?.settlement.kind,
        ],
        expected: ['daisy_web', { id: customerId, mode: 'test' }, 'unpaid'],
      });
      await assertRejects({
        given: 'another user selector through the real runtime role',
        should: 'refuse private settings data',
        code: 'AUTHORIZATION',
        actual: () => member.read({ ...subject, userId: createId() }),
      });
    },
  ));
