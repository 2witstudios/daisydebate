import Stripe from 'stripe';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { subscriptionGrants } from '@daisy/auth/authorization';
import { createId } from '@paralleldrive/cuid2';
import { fixedClock } from '@daisy/clock';
import { withSql, testDatabaseUrl } from './fixtures';
import { createBillingWebhook } from '../src/features/billing/webhook-handler';
import { createSubscriptionReconciliation } from '../src/features/billing/subscription-reconciliation';
import {
  identity,
  subscription,
  invoice,
} from '../src/features/billing/subscription-observation.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('signed HTTP receipts and scheduled vendor observations share durable synchronization without event-driven grants', async () =>
  withSql(async (sql) => {
    const userId = createId(),
      actorId = createId(),
      customerId = createId(),
      subscriptionId = createId(),
      instanceId = createId(),
      eventId = `evt_${createId()}`;
    const database = createDatabase({
      url: testDatabaseUrl,
      client: sql,
      nextActorId: createId,
    });
    const [clock] = await sql`select clock_timestamp() as now`;
    const now = clock.now.toISOString();
    const secret = 'whsec_controlled_integration_fixture';
    const body = JSON.stringify(
      {
        id: eventId,
        object: 'event',
        type: 'invoice.paid',
        livemode: false,
        data: { object: { customer: identity.customerId } },
      },
      null,
      2,
    );
    const header = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret,
      timestamp: Math.floor(Date.parse(now) / 1000),
    });
    const request = (payload = body) =>
      new Request('https://daisy.invalid/api/webhooks/stripe', {
        method: 'POST',
        body: payload,
        headers: { 'stripe-signature': header },
      });
    let loseReply = true,
      failures = 0;
    const handler = createBillingWebhook({
      config: {
        kind: 'stripe',
        mode: 'test',
        webhookSecret: secret,
        secretKey: 'sk_test_unused',
        premiumPriceId: identity.priceId,
        portalConfigurationId: 'bpc_fixture',
      },
      clock: fixedClock(now),
      deadline: () => AbortSignal.timeout(5000),
      receive: async (receipt) => {
        const result = await database.receiveBillingReceipt(receipt);
        if (loseReply) {
          loseReply = false;
          throw Error('controlled reply loss after actual commit');
        }
        return result;
      },
      failed: () => {
        failures += 1;
      },
    });
    try {
      await sql`insert into users(id,username) values(${userId},${userId})`;
      await sql`insert into actors(id,user_id,kind) values(${actorId},${userId},'human')`;
      await sql`insert into billing_customers(id,user_id,vendor_customer_id,mode,synchronization) values(${customerId},${userId},${identity.customerId},'test',${JSON.stringify({ kind: 'pending', revision: 1, requestedAt: now, retryAt: now })}::text::jsonb)`;
      await sql`insert into billing_subscriptions(id,user_id,vendor_subscription_id,evidence,current,observed_at) values(${subscriptionId},${userId},${identity.vendorSubscriptionId},'{"lifecycle":"incomplete","settlement":{"kind":"unpaid"}}'::jsonb,true,${now}::timestamptz)`;
      const uncertain = await handler(request());
      const duplicates = await Promise.all(
        Array.from({ length: 4 }, () => handler(request())),
      );
      const tampered = await handler(
        request(body.replace('cus_fixture', 'cus_attacker')),
      );
      const [receipt] =
        await sql`select count(*)::int as n from billing_webhook_events where vendor_event_id=${eventId}`;
      const [before] =
        await sql`select count(*)::int as n from account_entitlement_grants where user_id=${userId}`;
      assert({
        given:
          'an actual committed receipt with a lost application reply, concurrent redelivery and tampering',
        should:
          'recover one durable receipt while the signed payment hint alone grants nothing',
        actual: [
          uncertain.status,
          duplicates.map((r) => r.status),
          tampered.status,
          failures,
          receipt.n,
          before.n,
        ],
        expected: [503, [204, 204, 204, 204], 400, 1, 1, 0],
      });
      await database.renewServiceInstance({ instanceId, role: 'web' });
      const worker = createSubscriptionReconciliation({
        store: database.billingSynchronization(instanceId, subscriptionGrants),
        mode: 'test',
        priceId: identity.priceId,
        vendor: {
          subscription: async () => subscription,
          invoice: async () => invoice,
          latestPaidInvoice: async () => ({
            object: 'list',
            data: [invoice],
            has_more: false,
          }),
        },
        failed: () => {
          failures += 1;
        },
      });
      await worker.run();
      const [after] =
        await sql`select count(*)::int as n from account_entitlement_grants where user_id=${userId} and source='subscription'`;
      const [state] =
        await sql`select synchronization from billing_customers where id=${customerId}`;
      await handler(request());
      const [replay] =
        await sql`select synchronization from billing_customers where id=${customerId}`;
      assert({
        given:
          'a current scheduled worker fetching independently validated controlled vendor facts, followed by event replay',
        should:
          'apply all five capabilities once and leave the settled generation unchanged',
        actual: [
          after.n,
          state.synchronization.kind,
          state.synchronization.revision,
          replay,
          failures,
        ],
        expected: [5, 'settled', 2, state, 1],
      });
    } finally {
      await sql`delete from service_instances where instance_id=${instanceId}`;
      await sql`delete from billing_webhook_events where vendor_event_id=${eventId}`;
      await sql`delete from account_entitlement_grants where user_id=${userId}`;
      await sql`delete from billing_subscriptions where id=${subscriptionId}`;
      await sql`delete from billing_customers where id=${customerId}`;
      await sql`delete from actors where id=${actorId}`;
      await sql`delete from users where id=${userId}`;
    }
  }));
