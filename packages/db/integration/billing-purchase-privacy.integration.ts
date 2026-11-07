import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { erasePrivacySubject, exportPrivacySubject } from '../src/privacy';
import { bindings } from './privacy.test-support';
import { flagCommand } from './flags.test-support';
import { offer, withBillingPurchases } from './billing-purchases.test-support';

requireTestServices(process.env);
setupRitewayBun();
const rooms = {
  closeRoom: <T>(room: T) => room,
  eraseSeats: <T>(room: T) => room,
  activeRoomMembers: () => [],
};

test('local erasure keeps possible Checkout effects as an obligation while refusing old dispatch authority', async () =>
  withBillingPurchases(async ({ fixture, purchases, subject, store, key }) => {
    await store.runFlagCommand(flagCommand(key, 0));
    const first = await purchases.admit(subject, offer);
    const claimed = await purchases.recover(subject, first.purchase.id);
    const database = drizzle({ client: fixture.sql });
    const exported = await exportPrivacySubject(database, subject, rooms);
    assert({
      given: 'a private creation claim',
      should:
        'export own admitted offer and possible-execution evidence without internal claim identity',
      actual: [
        exported.billing_purchases!.map((row) => row.id),
        JSON.stringify(exported).includes(claimed.claimId!),
        exported.billing_purchases![0]!.state,
      ],
      expected: [
        [first.purchase.id],
        false,
        {
          kind: 'creating',
          startedAt:
            claimed.purchase.state.kind === 'creating'
              ? claimed.purchase.state.startedAt
              : null,
        },
      ],
    });
    const [clock] = await fixture.sql`select clock_timestamp() as now`;
    const erased = await erasePrivacySubject(
      database,
      { subject, now: clock!.now.toISOString(), vendors: [], jobIds: [] },
      rooms,
      bindings,
    );
    const [retained] =
      await fixture.sql`select state from billing_purchases where id=${first.purchase.id}`;
    await assertRejects({
      given: 'an old pre-erasure create claim',
      should: 'refuse any current-member dispatch recovery',
      code: 'AUTHORIZATION',
      actual: () => purchases.recover(subject, first.purchase.id),
    });
    await assertRejects({
      given: 'late completion through a closed member operation',
      should:
        'refuse grants or mapping resurrection while service cleanup remains owed',
      code: 'AUTHORIZATION',
      actual: () =>
        purchases.record(subject, first.purchase.id, {
          kind: 'observe',
          session: {
            kind: 'complete',
            id: `cs_test_${createId()}`,
            customerId: `cus_${createId()}`,
            subscriptionId: `sub_${createId()}`,
          },
        }),
    });
    const [effects] =
      await fixture.sql`select (select count(*)::int from billing_customers where user_id=${subject.userId}) as customers,(select count(*)::int from account_entitlement_grants where user_id=${subject.userId}) as grants`;
    assert({
      given: 'local closure without any vendor call',
      should:
        'preserve the unresolved purchase and zero renewed access rather than report vendor cleanup complete',
      actual: [erased.alreadyErased, retained!.state, effects],
      expected: [false, claimed.purchase.state, { customers: 0, grants: 0 }],
    });
  }));
