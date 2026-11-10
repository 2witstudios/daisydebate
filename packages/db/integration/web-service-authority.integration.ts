import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { availabilityOperations } from '../src/availability-operations';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { finishedOrBlockedBehind } from '../src/testing';
import { testLane } from '../src/testing-lane';
import { requireCurrentWeb } from '../src/web-service-authority';
import { withFixture } from './constraint-helpers';
import { withPool } from './bounded-transaction.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('held web authority lets its own lease renew and still fences the lease row (DAISY-WEB-9)', async () =>
  withFixture(url, async (fixture) =>
    withPool(async (client) => {
      const instanceId = createId();
      const leases = availabilityOperations(fixture.sql, fixture.sql);
      const run = createBoundedTransaction({
        lane: testLane(client, 4),
        now: performance.now,
      });
      await leases.renewServiceInstance({ instanceId, role: 'web' });
      const held = Promise.withResolvers<number>();
      const release = Promise.withResolvers<void>();
      const holder = run(async (tx, _signal, receipt) => {
        await requireCurrentWeb(tx, instanceId, true);
        held.resolve(receipt.writer.pid);
        await release.promise;
      });
      void holder.catch((error: unknown) => held.reject(error));
      try {
        const pid = await held.promise;
        const renewal = leases.renewServiceInstance({
          instanceId,
          role: 'web',
        });
        const renewed = await finishedOrBlockedBehind(
          renewal,
          fixture.sql,
          pid,
          { now: performance.now, deadlineMs: 1000 },
        );
        if (renewed === 'blocked') release.resolve();
        await renewal;
        // The retention purge's statement shape, scoped to this lease alone.
        const deletion = fixture.sql`delete from service_instances where instance_id=${instanceId} returning instance_id`;
        const deleted = await finishedOrBlockedBehind(
          deletion,
          fixture.sql,
          pid,
          { now: performance.now, deadlineMs: 1000 },
        );
        release.resolve();
        await holder;
        assert({
          given:
            'a maintenance transaction holding its own web authority to commit',
          should:
            'let the instance renew its lease at once and make deleting the lease wait for commit',
          actual: { renewed, deleted, removed: (await deletion).length },
          expected: { renewed: 'finished', deleted: 'blocked', removed: 1 },
        });
      } finally {
        release.resolve();
        await Promise.allSettled([holder]);
        await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      }
    }),
  ));

test('a lapsed web lease refuses with its typed reason, not its message (ISSUE-1010)', async () =>
  withFixture(url, async (fixture) =>
    withPool(async (client) => {
      const instanceId = createId();
      const run = createBoundedTransaction({
        lane: testLane(client, 4),
        now: performance.now,
      });
      await availabilityOperations(
        fixture.sql,
        fixture.sql,
      ).renewServiceInstance({ instanceId, role: 'web' });
      try {
        await fixture.sql`update service_instances set renewed_at=clock_timestamp()-interval '4 seconds' where instance_id=${instanceId}`;
        for (const lock of [false, true])
          await assertRejects({
            given: `a web lease last renewed 4 s ago (lock: ${lock})`,
            should: 'refuse its authority as a lease lapse',
            actual: () => run((tx) => requireCurrentWeb(tx, instanceId, lock)),
            code: 'AUTHORIZATION',
            reason: 'service-lease-lapsed',
          });
      } finally {
        await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
      }
    }),
  ));

test('a renewal of a lease another role holds writes nothing and is refused', async () =>
  withFixture(url, async (fixture) => {
    const instanceId = createId();
    const leases = availabilityOperations(fixture.sql, fixture.sql);
    try {
      await fixture.sql`insert into service_instances(instance_id,role,renewed_at,delivered_through,delivered_through_txid)
        values(${instanceId},'realtime',clock_timestamp()-interval '1 hour',0,'0'::xid8)`;
      await assertRejects({
        given: 'a realtime lease row renewed as web',
        should: 'refuse the renewal as a conflict',
        actual: () => leases.renewServiceInstance({ instanceId, role: 'web' }),
        code: 'CONFLICT',
      });
      const [untouched] =
        await fixture.sql`select role,renewed_at<clock_timestamp()-interval '59 minutes' as stale from service_instances where instance_id=${instanceId}`;
      await leases.renewServiceInstance({
        instanceId,
        role: 'realtime',
        deliveredThrough: { txid: '0', seq: 0n },
      });
      const [renewed] =
        await fixture.sql`select renewed_at>clock_timestamp()-interval '1 minute' as fresh from service_instances where instance_id=${instanceId}`;
      assert({
        given: 'the refused web renewal, then a renewal by its own role',
        should: 'leave the row untouched, then renew it',
        actual: { untouched, renewed },
        expected: {
          untouched: { role: 'realtime', stale: true },
          renewed: { fresh: true },
        },
      });
    } finally {
      await fixture.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }));
