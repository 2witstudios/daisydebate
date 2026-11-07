import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { sql, type SQL } from 'drizzle-orm';
import { causeChainMember } from '../src/capacity-refusal';
import { sqlStateOf } from './constraint-helpers';
import { flagCommand } from './flags.test-support';
import { offer, withBillingPurchases } from './billing-purchases.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('actual daisy_web purchase operations preserve admitted identity and all terminal evidence against direct mutation', async () =>
  withBillingPurchases(
    async ({ fixture, pool, run, purchases, subject, store, key }) => {
      await store.runFlagCommand(flagCommand(key, 0));
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
      const first = await purchases.admit(subject, offer);
      const claimed = await purchases.recover(subject, first.purchase.id);
      const id = first.purchase.id;
      const failures = [];
      const execute = (statement: SQL) =>
        run((tx) => tx.execute(statement)).catch((error) => {
          throw causeChainMember((cause) => 'errno' in cause, error) ?? error;
        });
      const before = [
        sql`update billing_purchases set id=${createId()} where id=${id}`,
        sql`update billing_purchases set user_id=${createId()} where id=${id}`,
        sql`update billing_purchases set mode='live' where id=${id}`,
        sql`update billing_purchases set price_id='price_changed' where id=${id}`,
        sql`update billing_purchases set vendor_customer_id=${`cus_${createId()}`} where id=${id}`,
        sql`update billing_purchases set return_origin='https://other.example' where id=${id}`,
        sql`update billing_purchases set admitted_at=admitted_at-interval '1 second' where id=${id}`,
        sql`update billing_purchases set state=jsonb_set(state,'{startedAt}',to_jsonb(to_char((admitted_at-interval '1 millisecond') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where id=${id}`,
        sql`update billing_purchases set state='{"kind":"admitted"}'::jsonb where id=${id}`,
        sql`update billing_purchases set state=jsonb_set(state,'{claim,expiresAt}',to_jsonb(to_char((clock_timestamp()+interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where id=${id}`,
      ];
      for (const mutation of before)
        failures.push(await sqlStateOf(() => execute(mutation)));
      assert({
        given:
          'direct runtime mutations of admitted offer, identity, time and possible dispatch',
        should: 'reject all without disturbing the live claim',
        actual: [role, failures, (await purchases.read(subject, id)).state],
        expected: [
          'daisy_web',
          before.map(() => '23514'),
          claimed.purchase.state,
        ],
      });
      const session = {
        kind: 'complete' as const,
        id: `cs_test_${createId()}`,
        customerId: `cus_${createId()}`,
        subscriptionId: `sub_${createId()}`,
      };
      const applied = await purchases.record(subject, id, {
        kind: 'observe',
        session,
      });
      const terminal = [
        sql`update billing_purchases set state=jsonb_set(state,'{sessionId}',to_jsonb(${`cs_test_${createId()}`}::text)) where id=${id}`,
        sql`update billing_purchases set state=jsonb_set(state,'{customerId}',to_jsonb(${`cus_${createId()}`}::text)) where id=${id}`,
        sql`update billing_purchases set state=jsonb_set(state,'{subscriptionId}',to_jsonb(${`sub_${createId()}`}::text)) where id=${id}`,
        sql`update billing_purchases set state=(state-'subscriptionId')||'{"kind":"open"}'::jsonb where id=${id}`,
      ];
      const terminalFailures = [];
      for (const mutation of terminal)
        terminalFailures.push(await sqlStateOf(() => execute(mutation)));
      const [permissions] =
        await fixture.sql`select has_table_privilege('daisy_realtime','billing_purchases','SELECT') as realtime_read,has_table_privilege('daisy_realtime','billing_purchases','DELETE') as realtime_delete`;
      assert({
        given: 'completed Session identity and the realtime role',
        should:
          'preserve terminal identities and keep all purchase access private to the web role',
        actual: [
          applied,
          terminalFailures,
          permissions,
          (await purchases.read(subject, id)).state.kind,
        ],
        expected: [
          'changed',
          terminal.map(() => '23514'),
          { realtime_read: false, realtime_delete: false },
          'complete',
        ],
      });
    },
  ));
