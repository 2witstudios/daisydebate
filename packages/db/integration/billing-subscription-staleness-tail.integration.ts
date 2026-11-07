import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src/index';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const key = (prefix: string, n: number) =>
  prefix.repeat(20) + n.toString(36).padStart(4, '0');

// Controlled history qualifies actual bounded reads, not a vendor payment.
test('actual role traversal reaches a stale subscription after twelve full pages without widening any query', async () =>
  withFixture(databaseUrl, async (fixture) => {
    const pool = new SQL(databaseUrl, { max: 4 }),
      instanceId = createId();
    const reserve = pool.reserve.bind(pool);
    pool.reserve = async (options) => {
      const connection = await reserve(options);
      await connection`set role daisy_web`;
      return connection;
    };
    const database = createDatabase({
      url: databaseUrl,
      client: pool,
      nextActorId: createId,
    });
    const reader = database.billingSubscriptionStaleness(instanceId);
    const cohort = Array.from({ length: 397 }, (_, n) => ({
      id: key('w', n + 1),
      userId: createId(),
    }));
    const data = JSON.stringify(cohort),
      last = cohort.at(-1)!;
    try {
      await fixture.sql`insert into users(id,username) select "userId","userId" from jsonb_to_recordset(${data}::text::jsonb) as x("userId" text)`;
      await fixture.sql`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
        insert into billing_customers(id,user_id,vendor_customer_id,mode,synchronization)
        select x.id,x."userId",'cus_'||x.id,'test',jsonb_build_object('kind','pending','revision',1,'requestedAt',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'retryAt',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        from jsonb_to_recordset(${data}::text::jsonb) as x(id text,"userId" text), sampled`;
      await fixture.sql`insert into billing_subscriptions(id,user_id,vendor_subscription_id,evidence,current,created_at,observed_at)
        values(${createId()},${last.userId},${`sub_${createId()}`},'{"lifecycle":"incomplete","settlement":{"kind":"unpaid"}}'::jsonb,true,clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '20 minutes')`;
      await database.renewServiceInstance({ instanceId, role: 'web' });
      let cursor: { afterId: string; throughId: string } | undefined,
        pages = 0,
        scanned = 0,
        knownTail = false;
      const prefixes: boolean[] = [];
      do {
        const page = await reader.sample({ mode: 'test', ...cursor });
        pages++;
        scanned += page.scanned;
        if (pages <= 12)
          prefixes.push(
            page.oldestObservedAt === null &&
              !page.exhausted &&
              page.scanned === 33,
          );
        if (page.oldestObservedAt)
          knownTail =
            Date.parse(page.sampledAt) - Date.parse(page.oldestObservedAt) >=
            1_200_000;
        cursor = page.exhausted
          ? undefined
          : { afterId: page.afterId!, throughId: page.throughId! };
        if (pages > 13) throw Error('Controlled finite cohort did not exhaust');
      } while (cursor);
      assert({
        given:
          '396 earlier unknown subscriptions and one controlled stale observation at the fixed tail',
        should:
          'reach the stale thirteenth page under actual web authority with every earlier query still bounded',
        actual: [
          pages,
          scanned,
          prefixes.length,
          prefixes.every(Boolean),
          knownTail,
        ],
        expected: [13, 397, 12, true, true],
      });
    } finally {
      await pool.close({ timeout: 0 });
      await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      await fixture.sql`delete from billing_subscriptions where user_id=${last.userId}`;
      await fixture.sql`delete from billing_customers where id in(select id from jsonb_to_recordset(${data}::text::jsonb) as x(id text))`;
      await fixture.sql`delete from users where id in(select "userId" from jsonb_to_recordset(${data}::text::jsonb) as x("userId" text))`;
    }
  }));
