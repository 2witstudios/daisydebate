import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { erasePrivacySubject, exportPrivacySubject } from '../src/privacy';
import { bindings } from './privacy.test-support';
import { withBillingSynchronization } from './billing-synchronization.test-support';

setupRitewayBun();
requireTestServices(process.env);
// These fixtures have no Rooms; the public composition still runs every adopter.
const rooms = {
  closeRoom: <T>(room: T) => room,
  eraseSeats: <T>(room: T) => room,
  activeRoomMembers: () => [],
};

test('full subject rights export isolates billing and closure prevents stale payment or webhook resurrection', async () =>
  withBillingSynchronization(
    async ({
      fixture,
      customerId,
      userId,
      actorId,
      vendorCustomerId,
      subscriptionId,
      inbox,
      store,
      paid,
    }) =>
      withBillingSynchronization(async (other) => {
        const eventId = `evt_${createId()}`;
        await inbox({ eventId, customerId: vendorCustomerId, mode: 'test' });
        const claim = (await store.claim(customerId))!;
        const subject = { userId, actorId };
        const database = drizzle({ client: fixture.sql });
        const exported = await exportPrivacySubject(database, subject, rooms);
        assert({
          given: 'two customers and a current private synchronization claim',
          should:
            'export only the subject billing facts, excluding internal claim identity',
          actual: [
            exported.billing_customers!.map((row) => row.id),
            exported.billing_subscriptions!.map((row) => row.id),
            exported.billing_webhook_events!.map((row) => row.vendor_event_id),
            JSON.stringify(exported).includes(other.userId),
            JSON.stringify(exported).includes(claim.claimId),
          ],
          expected: [[customerId], [subscriptionId], [eventId], false, false],
        });
        const [clock] = await fixture.sql`select clock_timestamp() as now`;
        const input = {
          subject,
          now: clock.now.toISOString(),
          vendors: [],
          jobIds: [],
        };
        const first = await erasePrivacySubject(
          database,
          input,
          rooms,
          bindings,
        );
        const second = await erasePrivacySubject(
          database,
          input,
          rooms,
          bindings,
        );
        const lateReceipt = {
          eventId: `evt_${createId()}`,
          customerId: vendorCustomerId,
          mode: 'test' as const,
        };
        const late = await inbox(lateReceipt);
        const [cleanup] =
          await fixture.sql`select id,status from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        const duplicate = await inbox(lateReceipt);
        const [replayedCleanup] =
          await fixture.sql`select id,status from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
        assert({
          given: 'a verified late customer event and identical replay',
          should:
            'retain a new cleanup obligation without rotating it on replay',
          actual: [cleanup?.status, duplicate, replayedCleanup],
          expected: ['pending', 'duplicate', cleanup],
        });
        const [customer] =
          await fixture.sql`select closed_at is not null as closed,synchronization->>'kind' as kind from billing_customers where id=${customerId}`;
        const [counts] =
          await fixture.sql`select (select count(*)::int from billing_subscriptions where user_id=${userId}) as subscriptions,(select count(*)::int from billing_webhook_events where vendor_customer_id=${vendorCustomerId}) as receipts,(select count(*)::int from account_entitlement_grants where user_id=${userId}) as grants`;
        assert({
          given:
            'repeat closure, a late verified receipt and a paid response from before erasure',
          should:
            'retain closed vendor-cleanup mapping and a minimal new receipt without recreating access',
          actual: [
            first.alreadyErased,
            second.alreadyErased,
            late,
            await store.apply(claim, paid),
            await store.claim(customerId),
            customer,
            counts,
          ],
          expected: [
            false,
            true,
            'closed',
            'stale',
            null,
            { closed: true, kind: 'settled' },
            { subscriptions: 0, receipts: 1, grants: 0 },
          ],
        });
        assert({
          given: 'the other subject',
          should: 'remain eligible for its own independent synchronization',
          actual: Boolean(await other.store.claim(other.customerId)),
          expected: true,
        });
      }),
  ));
