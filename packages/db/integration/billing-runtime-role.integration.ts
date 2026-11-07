import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { causeChainMember } from '../src/capacity-refusal';
import { sqlStateOf } from './constraint-helpers';
import { withBillingSynchronization } from './billing-synchronization.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('daisy_web can synchronize billing but cannot rewrite mapping, receipt or terminal subscription identity', async () =>
  withBillingSynchronization(
    async ({
      fixture,
      pool,
      run,
      customerId,
      userId,
      subscriptionId,
      vendorCustomerId,
      inbox,
      store,
      paid,
    }) => {
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
      const eventId = `evt_${createId()}`;
      const received = await inbox({
        eventId,
        customerId: vendorCustomerId,
        mode: 'test',
      });
      const claim = (await store.claim(customerId))!;
      const applied = await store.apply(claim, {
        ...paid,
        lifecycle: 'canceled',
      });
      assert({
        given:
          'ordinary bounded control transactions under the real production role',
        should: 'receive, claim and apply a verified terminal observation',
        actual: [role, received, applied],
        expected: ['daisy_web', 'recorded', 'applied'],
      });
      const mutations = [
        sql`update billing_customers set id=${createId()} where id=${customerId}`,
        sql`update billing_customers set user_id=${createId()} where id=${customerId}`,
        sql`update billing_customers set vendor_customer_id=${`cus_${createId()}`} where id=${customerId}`,
        sql`update billing_customers set mode='live' where id=${customerId}`,
        sql`update billing_customers set created_at=created_at+interval '1 second' where id=${customerId}`,
        sql`update billing_subscriptions set vendor_subscription_id=${`sub_${createId()}`} where id=${subscriptionId}`,
        sql`update billing_subscriptions set user_id=${createId()} where id=${subscriptionId}`,
        sql`update billing_subscriptions set evidence=jsonb_set(evidence,'{lifecycle}','"active"'::jsonb) where id=${subscriptionId}`,
        sql`update billing_webhook_events set vendor_event_id=${`evt_${createId()}`} where vendor_event_id=${eventId}`,
        sql`update billing_webhook_events set vendor_customer_id=${`cus_${createId()}`} where vendor_event_id=${eventId}`,
        sql`update billing_webhook_events set mode='live' where vendor_event_id=${eventId}`,
        sql`update billing_webhook_events set received_at=received_at-interval '1 second' where vendor_event_id=${eventId}`,
        sql`update billing_webhook_events set notified_at=null where vendor_event_id=${eventId}`,
      ];
      const rejected: (string | undefined)[] = [];
      for (const mutation of mutations)
        rejected.push(
          await sqlStateOf(() =>
            run((tx) => tx.execute(mutation)).catch((error) => {
              throw (
                causeChainMember((cause) => 'errno' in cause, error) ?? error
              );
            }),
          ),
        );
      await run((tx) =>
        tx.execute(
          sql`update billing_customers set closed_at=clock_timestamp() where id=${customerId}`,
        ),
      );
      const reopening = await sqlStateOf(() =>
        run((tx) =>
          tx.execute(
            sql`update billing_customers set closed_at=null where id=${customerId}`,
          ),
        ).catch((error) => {
          throw causeChainMember((cause) => 'errno' in cause, error) ?? error;
        }),
      );
      const [current] =
        await fixture.sql`select user_id,vendor_customer_id,mode,closed_at is not null as closed from billing_customers where id=${customerId}`;
      assert({
        given:
          'direct runtime attempts to rewrite original mappings, notification or terminal state',
        should:
          'reject every mutation and preserve the original closed identity',
        actual: [rejected, reopening, current],
        expected: [
          mutations.map(() => '23514'),
          '23514',
          {
            user_id: userId,
            vendor_customer_id: vendorCustomerId,
            mode: 'test',
            closed: true,
          },
        ],
      });
    },
  ));
