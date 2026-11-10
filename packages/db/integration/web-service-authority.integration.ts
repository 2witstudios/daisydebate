import { requireTestServices } from '@daisy/config';
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
