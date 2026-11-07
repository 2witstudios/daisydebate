import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { subscriptionGrants } from '@daisy/auth/authorization';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src/index';
import { withBillingSynchronization } from './billing-synchronization.test-support';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

// Owner-only setup is controlled history, never a claim of an actual hosted payment.
// All observations under test use the public store, current service and actual daisy_web role.
test('actual subscription application, new hints and ambiguous initialization remain distinguishable under current web authority', async () =>
  withBillingSynchronization(
    async ({ fixture, pool, userId, customerId, vendorCustomerId }) => {
      const roles = new Set<string>(),
        reserve = pool.reserve.bind(pool),
        instanceId = createId();
      pool.reserve = async (options) => {
        const connection = await reserve(options);
        await connection`set role daisy_web`;
        roles.add((await connection`select current_user as role`)[0]!.role);
        return connection;
      };
      const database = createDatabase({
        url: databaseUrl,
        client: pool,
        nextActorId: createId,
      });
      const reader = database.billingSubscriptionStaleness(instanceId);
      const worker = database.billingSynchronization(
        instanceId,
        subscriptionGrants,
      );
      try {
        await assertRejects({
          given: 'an unregistered observer',
          should: 'refuse before reading freshness',
          code: 'AUTHORIZATION',
          actual: () => reader.sample({ mode: 'test' }),
        });
        await database.renewServiceInstance({ instanceId, role: 'web' });
        const initial = await reader.sample({ mode: 'test' });
        const claim = (await worker.claim(customerId))!;
        const applied = await worker.apply(claim, {
          lifecycle: 'incomplete',
          settlement: { kind: 'unpaid' },
        });
        const settled = await reader.sample({ mode: 'test' });
        assert({
          given:
            'a real mapping placeholder then fenced application of a controlled normalized unpaid read',
          should:
            'leave initialization unconfirmed and recognize genuine settled application even for unchanged evidence',
          actual: [
            initial.pending,
            initial.unconfirmed,
            initial.oldestObservedAt,
            applied,
            settled.settled,
            settled.unconfirmed,
            settled.oldestObservedAt !== null,
            [...roles],
          ],
          expected: [1, 1, null, 'applied', 1, 0, true, ['daisy_web']],
        });
        await fixture.sql`update billing_subscriptions set created_at=observed_at where user_id=${userId}`;
        const notify = () =>
          worker.receive({
            eventId: `evt_${createId()}`,
            customerId: vendorCustomerId,
            mode: 'test',
          });
        await notify();
        const equal = await reader.sample({ mode: 'test' });
        await fixture.sql`update billing_subscriptions set created_at=clock_timestamp()-interval '30 minutes',observed_at=clock_timestamp()-interval '20 minutes' where user_id=${userId}`;
        await notify();
        const hinted = await reader.sample({ mode: 'test' });
        await notify();
        const repeated = await reader.sample({ mode: 'test' });
        assert({
          given:
            'same-time ambiguity then a controlled old observation and repeated fresh revision hints',
          should:
            'retain unknown for equality and expose stale observation age independently from current revision request age',
          actual: [
            equal.unconfirmed,
            equal.oldestObservedAt,
            Date.parse(hinted.sampledAt) -
              Date.parse(hinted.oldestObservedAt!) >=
              1_200_000,
            Date.parse(repeated.sampledAt) -
              Date.parse(repeated.oldestRevisionRequestedAt!) <
              15_000,
            repeated.oldestObservedAt === hinted.oldestObservedAt,
            repeated.unconfirmed,
          ],
          expected: [1, null, true, true, true, 0],
        });
        await fixture.sql`update billing_subscriptions set observed_at=clock_timestamp()+interval '1 minute' where user_id=${userId}`;
        const future = await reader.sample({ mode: 'test' });
        await fixture.sql`update billing_subscriptions set observed_at=created_at-interval '1 millisecond' where user_id=${userId}`;
        const inconsistent = await reader.sample({ mode: 'test' });
        await fixture.sql`update billing_subscriptions set current=false where user_id=${userId}`;
        const missing = await reader.sample({ mode: 'test' });
        assert({
          given: 'future, reversed and missing current subscription facts',
          should:
            'keep every observation unconfirmed instead of manufacturing a successful read',
          actual: [future, inconsistent, missing].map((row) => [
            row.pending,
            row.unconfirmed,
            row.oldestObservedAt,
          ]),
          expected: [
            [1, 1, null],
            [1, 1, null],
            [1, 1, null],
          ],
        });
        await fixture.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
        await assertRejects({
          given: 'lost service authority',
          should: 'refuse a subsequent freshness page',
          code: 'AUTHORIZATION',
          actual: () => reader.sample({ mode: 'test' }),
        });
      } finally {
        await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      }
    },
  ));

const key = (prefix: string, n: number) =>
  prefix.repeat(20) + n.toString(36).padStart(4, '0');
test('indexed freshness pages retain missing subscriptions, exclude other modes/erasure and finish a fixed range despite a newer tail', async () =>
  withFixture(databaseUrl, async (fixture) => {
    const pool = new SQL(databaseUrl, { max: 4 }),
      instanceId = createId(),
      owned: string[] = [];
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
    async function add(
      prefix: string,
      n: number,
      mode = 'test',
      erased = false,
      closed = false,
    ) {
      const userId = await fixture.user(),
        id = key(prefix, n);
      owned.push(id);
      await fixture.sql`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
        insert into billing_customers(id,user_id,vendor_customer_id,mode,synchronization,created_at,closed_at)
        select ${id},${userId},${`cus_${createId()}`},${mode},jsonb_build_object('kind','pending','revision',1,'requestedAt',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'retryAt',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),at,case when ${closed} then at else null end from sampled`;
      if (erased)
        await fixture.sql`update users set deleted_at=clock_timestamp(),version=version+1 where id=${userId}`;
    }
    try {
      for (let n = 1; n <= 35; n++)
        await add('x', n, n === 1 ? 'live' : 'test', n === 2);
      await add('y', 1, 'test', false, true);
      await database.renewServiceInstance({ instanceId, role: 'web' });
      const first = await reader.sample({ mode: 'test' });
      await fixture.sql`delete from billing_customers where id=${key('x', 35)}`;
      await add('z', 1);
      const second = await reader.sample({
        mode: 'test',
        afterId: first.afterId!,
        throughId: first.throughId!,
      });
      const fresh = await reader.sample({ mode: 'test' });
      const live = await reader.sample({ mode: 'live' });
      assert({
        given:
          '35 open rows with other-mode/erased members, a closed row, deleted captured maximum and a later new tail',
        should:
          'bound examined rows, retain unknown missing subscriptions and finish captured coverage without chasing new identities',
        actual: [
          [
            first.scanned,
            first.pending,
            first.unconfirmed,
            first.exhausted,
            first.throughId,
          ],
          [
            second.scanned,
            second.pending,
            second.unconfirmed,
            second.exhausted,
            second.throughId,
          ],
          fresh.throughId,
          live.pending,
          live.unconfirmed,
        ],
        expected: [
          [33, 31, 31, false, key('x', 35)],
          [1, 1, 1, true, key('x', 35)],
          key('z', 1),
          1,
          1,
        ],
      });
      const empty = await reader.sample({
        mode: 'test',
        afterId: key('z', 1),
        throughId: key('z', 1),
      });
      assert({
        given: 'no remaining row inside the captured range',
        should: 'return explicit empty exhaustion',
        actual: [
          empty.scanned,
          empty.pending,
          empty.oldestObservedAt,
          empty.exhausted,
        ],
        expected: [0, 0, null, true],
      });
    } finally {
      await pool.close({ timeout: 0 });
      await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      for (const id of owned)
        await fixture.sql`delete from billing_customers where id=${id}`;
    }
  }));
